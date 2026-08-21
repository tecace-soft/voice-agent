"""One-time: authorize the transcribe app to upload voicemails to YOUR Google Drive.

On a personal @gmail.com a service account can't own uploaded files (it has no storage quota), so
Drive upload runs as a real user. This script does the one browser sign-in that mints a long-lived
refresh token; after that the poller uploads unattended, forever, using that token.

    python scripts/authorize_drive.py --client-secrets /path/to/oauth_client.json

Prereqs (once, in Google Cloud Console for any project with the Drive API enabled):
  1. APIs & Services -> Credentials -> Create credentials -> OAuth client ID -> "Desktop app".
     Download its JSON (pass it as --client-secrets), OR set GOOGLE_OAUTH_CLIENT_ID /
     GOOGLE_OAUTH_CLIENT_SECRET in .env and omit --client-secrets.
  2. OAuth consent screen -> add yourself as a user and PUBLISH the app to "Production" (a
     "Testing" app's refresh tokens expire after 7 days; a Production app's do not). The only
     scope requested is drive.file (non-sensitive), so no Google verification is required.

Sign in as the account whose Drive (and 15 GB) should hold the recordings. The script prints a
refresh token and a Drive folder id — paste both into .env, then set DRIVE_UPLOAD=1.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# Same scope the uploader uses: the app only ever touches files/folders it creates.
SCOPES = ["https://www.googleapis.com/auth/drive.file"]
FOLDER_MIME = "application/vnd.google-apps.folder"


def _flow(client_secrets: str | None) -> InstalledAppFlow:
    if client_secrets:
        return InstalledAppFlow.from_client_secrets_file(client_secrets, SCOPES)
    client_id = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "").strip()
    client_secret = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "").strip()
    if not (client_id and client_secret):
        print(
            "No OAuth client found. Pass --client-secrets /path/to/oauth_client.json, or set "
            "GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env first."
        )
        raise SystemExit(2)
    config = {
        "installed": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost"],
        }
    }
    return InstalledAppFlow.from_client_config(config, SCOPES)


def _find_or_create_folder(creds, name: str) -> str:
    """Reuse a folder of this name the app created earlier (drive.file only sees the app's own
    files), otherwise create it. Returns the folder id."""
    drive = build("drive", "v3", credentials=creds, cache_discovery=False)
    q = f"mimeType='{FOLDER_MIME}' and name='{name}' and trashed=false"
    found = drive.files().list(q=q, spaces="drive", fields="files(id,name)").execute().get("files", [])
    if found:
        return found[0]["id"]
    created = drive.files().create(
        body={"name": name, "mimeType": FOLDER_MIME}, fields="id"
    ).execute()
    return created["id"]


def main() -> int:
    parser = argparse.ArgumentParser(description="Authorize Drive upload for the transcribe app.")
    parser.add_argument(
        "--client-secrets",
        help="Path to the downloaded OAuth 'Desktop app' client JSON. Omit to use "
        "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET from the environment.",
    )
    parser.add_argument(
        "--folder-name",
        default="Voicemail recordings",
        help="Name of the Drive folder to upload into (created if absent). Default: %(default)s.",
    )
    parser.add_argument(
        "--no-folder",
        action="store_true",
        help="Skip folder creation; recordings go to My Drive root (GOOGLE_DRIVE_FOLDER_ID empty).",
    )
    args = parser.parse_args()

    # access_type=offline + prompt=consent guarantee Google returns a refresh token (not just an
    # access token), which is the whole point of this one-time flow.
    creds = _flow(args.client_secrets).run_local_server(
        port=0, access_type="offline", prompt="consent"
    )
    if not creds.refresh_token:
        print(
            "\nNo refresh token was returned. Re-run and make sure you approve the consent screen; "
            "if it keeps happening, revoke the app at https://myaccount.google.com/permissions and "
            "try again."
        )
        return 1

    folder_id = "" if args.no_folder else _find_or_create_folder(creds, args.folder_name)

    print("\n" + "=" * 72)
    print("Success. Add these to transcribe-app/.env:\n")
    print("DRIVE_UPLOAD=1")
    print(f"GOOGLE_OAUTH_CLIENT_ID={creds.client_id}")
    print(f"GOOGLE_OAUTH_CLIENT_SECRET={creds.client_secret}")
    print(f"GOOGLE_OAUTH_REFRESH_TOKEN={creds.refresh_token}")
    if folder_id:
        print(f"GOOGLE_DRIVE_FOLDER_ID={folder_id}   # folder '{args.folder_name}'")
    else:
        print("# GOOGLE_DRIVE_FOLDER_ID left empty -> uploads go to My Drive root")
    print("# DRIVE_PUBLIC=1 (default) gives each file an 'anyone with the link' download link;")
    print("#   set DRIVE_PUBLIC=0 to keep recordings private to this account + shared users.")
    print("=" * 72)
    # Also dump a machine-readable line in case you'd rather script the .env write.
    print("\nJSON: " + json.dumps({
        "client_id": creds.client_id,
        "refresh_token": creds.refresh_token,
        "folder_id": folder_id,
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
