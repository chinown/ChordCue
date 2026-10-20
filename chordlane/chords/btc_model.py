# Bi-directional Transformer for Chord recognition (BTC), inference-only.
#
# Adapted from https://github.com/jayg996/BTC-ISMIR19 (btc_model.py and
# utils/transformer_modules.py). Training code and attention-map plumbing were
# dropped; module names are unchanged so the published checkpoints load as-is.
#
# MIT License
# Copyright (c) 2019 Jonggwon Park
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

import math

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

# run_config.yaml from the original repo, with the large-vocabulary settings.
CONFIG = {
    "song_hz": 22050,
    "inst_len": 10.0,
    "n_bins": 144,
    "bins_per_octave": 24,
    "hop_length": 2048,
    "feature_size": 144,
    "timestep": 108,
    "num_chords": 170,
    "num_layers": 8,
    "num_heads": 4,
    "hidden_size": 128,
    "total_key_depth": 128,
    "total_value_depth": 128,
    "filter_size": 128,
}

ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
# Order of qualities inside each root's block of 14 output classes.
QUALITIES = ["min", "maj", "dim", "aug", "min6", "maj6", "min7", "minmaj7",
             "maj7", "7", "dim7", "hdim7", "sus2", "sus4"]
UNKNOWN_IDX = 168  # "X"
NO_CHORD_IDX = 169  # "N"


def _gen_bias_mask(max_length):
    np_mask = np.triu(np.full([max_length, max_length], -np.inf), 1)
    return torch.from_numpy(np_mask).float().unsqueeze(0).unsqueeze(1)


def _gen_timing_signal(length, channels, min_timescale=1.0, max_timescale=1.0e4):
    position = np.arange(length)
    num_timescales = channels // 2
    log_timescale_increment = math.log(float(max_timescale) / float(min_timescale)) / (float(num_timescales) - 1)
    inv_timescales = min_timescale * np.exp(np.arange(num_timescales).astype(float) * -log_timescale_increment)
    scaled_time = np.expand_dims(position, 1) * np.expand_dims(inv_timescales, 0)
    signal = np.concatenate([np.sin(scaled_time), np.cos(scaled_time)], axis=1)
    signal = np.pad(signal, [[0, 0], [0, channels % 2]], "constant", constant_values=[0.0, 0.0])
    return torch.from_numpy(signal.reshape([1, length, channels])).float()


class LayerNorm(nn.Module):
    def __init__(self, features, eps=1e-6):
        super().__init__()
        self.gamma = nn.Parameter(torch.ones(features))
        self.beta = nn.Parameter(torch.zeros(features))
        self.eps = eps

    def forward(self, x):
        mean = x.mean(-1, keepdim=True)
        std = x.std(-1, keepdim=True)
        return self.gamma * (x - mean) / (std + self.eps) + self.beta


class SoftmaxOutputLayer(nn.Module):
    def __init__(self, hidden_size, output_size):
        super().__init__()
        self.output_size = output_size
        self.output_projection = nn.Linear(hidden_size, output_size)
        # Unused at inference, but present in the checkpoint.
        self.lstm = nn.LSTM(input_size=hidden_size, hidden_size=hidden_size // 2, batch_first=True, bidirectional=True)

    def forward(self, hidden):
        return self.output_projection(hidden)


class MultiHeadAttention(nn.Module):
    def __init__(self, input_depth, total_key_depth, total_value_depth, output_depth, num_heads, bias_mask=None):
        super().__init__()
        self.num_heads = num_heads
        self.query_scale = (total_key_depth // num_heads) ** -0.5
        self.register_buffer("bias_mask", bias_mask, persistent=False)
        self.query_linear = nn.Linear(input_depth, total_key_depth, bias=False)
        self.key_linear = nn.Linear(input_depth, total_key_depth, bias=False)
        self.value_linear = nn.Linear(input_depth, total_value_depth, bias=False)
        self.output_linear = nn.Linear(total_value_depth, output_depth, bias=False)

    def _split_heads(self, x):
        b, t, d = x.shape
        return x.view(b, t, self.num_heads, d // self.num_heads).permute(0, 2, 1, 3)

    def _merge_heads(self, x):
        b, h, t, d = x.shape
        return x.permute(0, 2, 1, 3).contiguous().view(b, t, d * h)

    def forward(self, queries, keys, values):
        queries = self._split_heads(self.query_linear(queries)) * self.query_scale
        keys = self._split_heads(self.key_linear(keys))
        values = self._split_heads(self.value_linear(values))
        logits = torch.matmul(queries, keys.permute(0, 1, 3, 2))
        if self.bias_mask is not None:
            logits = logits + self.bias_mask[:, :, :logits.shape[-2], :logits.shape[-1]].type_as(logits)
        weights = F.softmax(logits, dim=-1)
        return self.output_linear(self._merge_heads(torch.matmul(weights, values)))


class Conv(nn.Module):
    def __init__(self, input_size, output_size, kernel_size):
        super().__init__()
        self.pad = nn.ConstantPad1d((kernel_size // 2, (kernel_size - 1) // 2), 0)
        self.conv = nn.Conv1d(input_size, output_size, kernel_size=kernel_size, padding=0)

    def forward(self, inputs):
        return self.conv(self.pad(inputs.permute(0, 2, 1))).permute(0, 2, 1)


class PositionwiseFeedForward(nn.Module):
    def __init__(self, input_depth, filter_size, output_depth):
        super().__init__()
        self.layers = nn.ModuleList([Conv(input_depth, filter_size, 3), Conv(filter_size, output_depth, 3)])

    def forward(self, x):
        # The original applies ReLU after every layer, the last one included.
        for layer in self.layers:
            x = F.relu(layer(x))
        return x


class SelfAttentionBlock(nn.Module):
    def __init__(self, hidden_size, total_key_depth, total_value_depth, filter_size, num_heads, bias_mask):
        super().__init__()
        self.multi_head_attention = MultiHeadAttention(hidden_size, total_key_depth, total_value_depth,
                                                       hidden_size, num_heads, bias_mask)
        self.positionwise_convolution = PositionwiseFeedForward(hidden_size, filter_size, hidden_size)
        self.layer_norm_mha = LayerNorm(hidden_size)
        self.layer_norm_ffn = LayerNorm(hidden_size)

    def forward(self, x):
        x_norm = self.layer_norm_mha(x)
        x = x + self.multi_head_attention(x_norm, x_norm, x_norm)
        x_norm = self.layer_norm_ffn(x)
        return x + self.positionwise_convolution(x_norm)


class BiDirectionalSelfAttention(nn.Module):
    def __init__(self, hidden_size, total_key_depth, total_value_depth, filter_size, num_heads, max_length):
        super().__init__()
        mask = _gen_bias_mask(max_length)
        self.attn_block = SelfAttentionBlock(hidden_size, total_key_depth, total_value_depth,
                                             filter_size, num_heads, mask)
        self.backward_attn_block = SelfAttentionBlock(hidden_size, total_key_depth, total_value_depth,
                                                      filter_size, num_heads, torch.transpose(mask, 2, 3))
        self.linear = nn.Linear(hidden_size * 2, hidden_size)

    def forward(self, x):
        return self.linear(torch.cat((self.attn_block(x), self.backward_attn_block(x)), dim=2))


class BiDirectionalSelfAttentionLayers(nn.Module):
    def __init__(self, cfg):
        super().__init__()
        hidden = cfg["hidden_size"]
        self.register_buffer("timing_signal", _gen_timing_signal(cfg["timestep"], hidden), persistent=False)
        self.embedding_proj = nn.Linear(cfg["feature_size"], hidden, bias=False)
        self.self_attn_layers = nn.Sequential(*[
            BiDirectionalSelfAttention(hidden, cfg["total_key_depth"], cfg["total_value_depth"],
                                       cfg["filter_size"], cfg["num_heads"], cfg["timestep"])
            for _ in range(cfg["num_layers"])
        ])
        self.layer_norm = LayerNorm(hidden)

    def forward(self, inputs):
        x = self.embedding_proj(inputs)
        x = x + self.timing_signal[:, :inputs.shape[1], :].type_as(x)
        return self.layer_norm(self.self_attn_layers(x))


class BTCModel(nn.Module):
    def __init__(self, cfg=CONFIG):
        super().__init__()
        self.timestep = cfg["timestep"]
        self.self_attn_layers = BiDirectionalSelfAttentionLayers(cfg)
        self.output_layer = SoftmaxOutputLayer(cfg["hidden_size"], cfg["num_chords"])

    def forward(self, x):
        """x: (batch, timestep, 144) normalized log-CQT -> logits (batch, timestep, 170)."""
        return self.output_layer(self.self_attn_layers(x))
