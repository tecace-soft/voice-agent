"""Build Google credentials from Config.

Two identities live here:
  - Service account (Sheets): unattended, no browser — a private key the app signs with. Supplied
    three ways (checked in order): private key + client email, full JSON inline, or a JSON key file.
  - A real user via OAuth (Drive): needed because on a personal @gmail.com a service account has no
    storage quota and can't own uploaded files. We hold a long-lived refresh token (minted once by
    scripts/authorize_drive.py) and mint access tokens from it, so the poller still runs unattended.
"""

from __future__ import annotations

import json

from google.oauth2.credentials import Credentials as UserCredentials
from google.oauth2.service_account import Credentials

from ..config import Config

# The OAuth2 token endpoint is the same for every service account, so we can supply it when
# building credentials from just a private key + email (rather than a full JSON file).
_TOKEN_URI = "https://oauth2.googleapis.com/token"


def load_service_credentials(cfg: Config, scopes: list[str]) -> Credentials:
    """Service-account credentials for the given scopes, from whichever key source is configured."""
    # 1. Leanest: just the private key + email (token endpoint is a constant).
    if cfg.google_private_key and cfg.google_client_email:
        return Credentials.from_service_account_info(
            {
                "client_email": cfg.google_client_email,
                "private_key": cfg.google_private_key,
                "token_uri": _TOKEN_URI,
            },
            scopes=scopes,
        )
    # 2. Full JSON inline.
    if cfg.google_credentials_json:
        return Credentials.from_service_account_info(
            json.loads(cfg.google_credentials_json), scopes=scopes
        )
    # 3. JSON key file on disk.
    return Credentials.from_service_account_file(cfg.google_credentials_file, scopes=scopes)


def load_user_credentials(cfg: Config, scopes: list[str]) -> UserCredentials:
    """User OAuth credentials (for Drive), built from the stored refresh token + OAuth client.

    The access token is left None on purpose — google-auth refreshes it from the refresh token on
    first use and again whenever it expires, so the unattended poller never needs a browser."""
    return UserCredentials(
        None,
        refresh_token=cfg.google_oauth_refresh_token,
        token_uri=_TOKEN_URI,
        client_id=cfg.google_oauth_client_id,
        client_secret=cfg.google_oauth_client_secret,
        scopes=scopes,
    )
