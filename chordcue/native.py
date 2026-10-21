"""Register ChordCue with the browsers so the extension can start it.

Writes native/com.chordcue.launcher.json (the native-messaging manifest)
and points each Chromium browser's per-user registry key at it. No admin
rights needed. setup.bat runs `install`.

    python -m chordcue.native install
    python -m chordcue.native uninstall
    python -m chordcue.native status
"""

import json
import sys

from . import config

HOST_NAME = "com.chordcue.launcher"
# Fixed by the "key" in extension/manifest.json, so it's the same on every computer.
EXTENSION_ID = "adanfciiakcnddkbckmoochhdnepnogm"
# Each browser reads its own vendor key (HKEY_CURRENT_USER).
BROWSER_KEYS = {
    "Chrome": r"Software\Google\Chrome\NativeMessagingHosts",
    "Brave": r"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts",
    "Edge": r"Software\Microsoft\Edge\NativeMessagingHosts",
    "Chromium": r"Software\Chromium\NativeMessagingHosts",
}


def manifest_path():
    return config.ROOT / "native" / f"{HOST_NAME}.json"


def host_path():
    return config.ROOT / "native" / "chordcue-host.bat"


def install():
    import winreg

    manifest = {
        "name": HOST_NAME,
        "description": "Starts the ChordCue chord server when the extension needs it",
        "path": str(host_path()),
        "type": "stdio",
        "allowed_origins": [f"chrome-extension://{EXTENSION_ID}/"],
    }
    manifest_path().write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    for key in BROWSER_KEYS.values():
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, rf"{key}\{HOST_NAME}") as k:
            winreg.SetValueEx(k, "", 0, winreg.REG_SZ, str(manifest_path()))


def uninstall():
    import winreg

    for key in BROWSER_KEYS.values():
        try:
            winreg.DeleteKey(winreg.HKEY_CURRENT_USER, rf"{key}\{HOST_NAME}")
        except FileNotFoundError:
            pass
    manifest_path().unlink(missing_ok=True)


def status():
    import winreg

    found = {}
    for browser, key in BROWSER_KEYS.items():
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, rf"{key}\{HOST_NAME}") as k:
                found[browser] = winreg.QueryValueEx(k, "")[0]
        except FileNotFoundError:
            found[browser] = None
    return found


def main(argv=None):
    cmd = (argv or sys.argv[1:] or ["status"])[0]
    if sys.platform != "win32":
        print("Browser registration is only automated on Windows.")
        return 1
    if cmd == "install":
        install()
        print("ChordCue is registered with Chrome, Brave, Edge and Chromium.")
    elif cmd == "uninstall":
        uninstall()
        print("ChordCue is no longer registered with your browsers.")
    elif cmd == "status":
        for browser, path in status().items():
            print(f"{browser:9} {'registered' if path else 'not registered'}")
    else:
        print(__doc__)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
