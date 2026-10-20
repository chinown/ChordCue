"""Backend checks that need no network or GPU: python -m pytest tests  (or python tests/test_backend.py)."""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from chordlane import index, sources, theory  # noqa: E402
from chordlane.chords import recognize  # noqa: E402


def test_parse_links():
    assert sources.parse_link("https://youtu.be/CGj85pVzRJs?t=3")[:2] == ("youtube", "CGj85pVzRJs")
    assert sources.parse_link("https://www.youtube.com/watch?v=CGj85pVzRJs&list=x")[:2] == ("youtube", "CGj85pVzRJs")
    assert sources.parse_link("https://music.youtube.com/watch?v=CGj85pVzRJs")[:2] == ("youtube", "CGj85pVzRJs")
    assert sources.parse_link("https://www.youtube.com/shorts/CGj85pVzRJs")[:2] == ("youtube", "CGj85pVzRJs")
    assert sources.parse_link("https://open.spotify.com/intl-pt/track/4uLU6hMCjMI75M1A2tKUQC?si=1")[:2] == \
        ("spotify", "4uLU6hMCjMI75M1A2tKUQC")
    assert sources.parse_link("spotify:track:4uLU6hMCjMI75M1A2tKUQC")[0] == "spotify"
    assert sources.parse_link("soundcloud.com/artist/track-name")[0] == "soundcloud"
    for bad in ("https://example.com/x", "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
                "https://soundcloud.com/artist"):
        try:
            sources.parse_link(bad)
        except sources.SourceError:
            continue
        raise AssertionError(f"{bad} should be rejected")


def test_title_artist_from_youtube_titles():
    ta = sources._title_artist
    assert ta({"title": "The Beatles - The Beatles - Let It Be (Official Music Video) [Remastered 2015]",
               "uploader": "The Beatles"}) == ("Let It Be", "The Beatles")
    assert ta({"title": "Adele - Hello (Official Music Video)", "uploader": "AdeleVEVO"}) == ("Hello", "Adele")
    assert ta({"title": "Some Song", "uploader": "Band - Topic"}) == ("Some Song", "Band")
    assert ta({"track": "Rick Astley - Never Gonna Give You Up", "artist": "Rick Astley"}) == \
        ("Never Gonna Give You Up", "Rick Astley")


def test_query_key_ignores_decorations():
    a = index.query_key("Let It Be - Remastered 2009", "The Beatles")
    b = index.query_key("Let It Be", "The Beatles, Billy Preston")
    assert a == b == "q:the beatles|let it be"


def seg(root, q, start, end):
    return {"chord": {"root": root, "q": q}, "start": start, "end": end}


def test_detect_key():
    # I-V-vi-IV in G, starting and ending on G.
    song = [seg(7, "", 0, 4), seg(2, "", 4, 8), seg(4, "m", 8, 12), seg(0, "", 12, 16)] * 4 + [seg(7, "", 64, 70)]
    tonic, mode, _ = theory.detect_key(song)
    assert (tonic, mode) == (7, "major")
    # i-VI-III-VII in A minor.
    song = [seg(9, "m", 0, 4), seg(5, "", 4, 8), seg(0, "", 8, 12), seg(7, "", 12, 16)] * 4 + [seg(9, "m", 64, 70)]
    tonic, mode, _ = theory.detect_key(song)
    assert (tonic, mode) == (9, "minor")
    assert theory.key_name(10, "major") == "Bb"
    assert theory.key_name(6, "minor") == "F#m"


def test_viterbi_smooths_flicker():
    # Two labels; a single noisy beat of label 1 inside a run of label 0 should be ignored.
    em = np.log(np.array([[0.9, 0.1]] * 5 + [[0.4, 0.6]] + [[0.9, 0.1]] * 5))
    path = recognize._viterbi(em, np.full(len(em), 2.0))
    assert list(path) == [0] * 11
    # A sustained change is kept.
    em = np.log(np.array([[0.9, 0.1]] * 5 + [[0.1, 0.9]] * 5))
    assert list(recognize._viterbi(em, np.full(len(em), 2.0))) == [0] * 5 + [1] * 5


def test_label_mapping():
    assert recognize.label_for(0) == {"root": 0, "q": "m"}      # C:min
    assert recognize.label_for(1) == {"root": 0, "q": ""}       # C
    assert recognize.label_for(14 * 7 + 9) == {"root": 7, "q": "7"}  # G:7
    assert recognize.label_for(168) is None and recognize.label_for(169) is None


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
