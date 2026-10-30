
import requests
from pathlib import Path

# Complaint to attach the audio to
url = "http://127.0.0.1:8000/complaints/7/media"

# CHANGE THIS to the actual path of your audio recording
audio_path = Path(
    r"D:\Machine Learnning\ReelAudio-95676.mp3"
)
# Check whether the audio file exists
if not audio_path.is_file():
    print("ERROR: Audio file not found.")
    print("Expected location:", audio_path)
    raise SystemExit(1)

# Enter your current citizen token locally when prompted
token = input("Paste your current citizen access token: ").strip()

if not token:
    print("ERROR: Token cannot be empty.")
    raise SystemExit(1)

headers = {
    "Authorization": f"Bearer {token}"
}

# Set the MIME type based on the file extension
mime_types = {
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".webm": "audio/webm",
    ".ogg": "audio/ogg",
    ".aac": "audio/aac",
}

content_type = mime_types.get(audio_path.suffix.lower())

if content_type is None:
    print("ERROR: Unsupported audio extension:", audio_path.suffix)
    raise SystemExit(1)

try:
    with audio_path.open("rb") as audio:
        files = {
            "audio": (
                audio_path.name,
                audio,
                content_type
            )
        }

        response = requests.post(
            url,
            headers=headers,
            files=files,
            timeout=30
        )

    print("\nHTTP status:", response.status_code)
    print("Response:")

    try:
        data = response.json()
        print(data)

        if response.status_code == 200:
            print("\nSUCCESS: Audio uploaded!")

            if data.get("audio_url"):
                print("Audio URL:", data["audio_url"])

    except ValueError:
        print(response.text)

except requests.exceptions.ConnectionError:
    print("ERROR: FastAPI is not running at", url)

except requests.exceptions.Timeout:
    print("ERROR: Request timed out.")

except requests.exceptions.RequestException as error:
    print("ERROR:", error)
