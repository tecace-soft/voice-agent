"""Build service-account credentials from Config, for any Google API (Sheets, Drive).

The key can be supplied three ways (checked in this order): a private key + client email, the full
JSON inline, or a JSON key file on disk. Scopes differ per API, so the caller passes what it needs
— that's why this is shared between the Sheets writer and the Drive uploader.
"""

from __future__ import annotations

import json

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
