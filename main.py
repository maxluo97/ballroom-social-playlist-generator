import spotipy
from spotipy import SpotifyClientCredentials

from typing import List

clientID = ""
clientSecret = ""

clientCredentialManager = SpotifyClientCredentials(
    client_id = clientID,
    client_secret = clientSecret,
)

sp = spotipy.Spotify(client_credentials_manager = clientCredentialManager)

def searchSongs(query: str) -> List[Song]:
    results = sp.search(query, limit = 10)