from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Final
from urllib.parse import urlparse


ROOT_DIR: Final[Path] = Path(__file__).resolve().parent
TEMPLATES_DIR: Final[Path] = ROOT_DIR / "templates"
STATIC_DIR: Final[Path] = ROOT_DIR / "static"
HOST: Final[str] = "0.0.0.0"
PORT: Final[int] = 8080


def get_content_type(file_path: Path) -> str:
    suffix = file_path.suffix.lower()
    if suffix == ".html":
        return "text/html; charset=utf-8"
    if suffix == ".js":
        return "application/javascript; charset=utf-8"
    if suffix == ".css":
        return "text/css; charset=utf-8"
    if suffix == ".json":
        return "application/json; charset=utf-8"
    if suffix == ".png":
        return "image/png"
    if suffix in {".jpg", ".jpeg"}:
        return "image/jpeg"
    return "application/octet-stream"


class RoomSchedulerHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        parsed_path = urlparse(self.path)
        request_path = parsed_path.path

        if request_path == "/":
            self.serve_file(TEMPLATES_DIR / "index.html")
            return

        if request_path.startswith("/static/"):
            relative_path = request_path.removeprefix("/static/")
            static_file = (STATIC_DIR / relative_path).resolve()
            if STATIC_DIR not in static_file.parents and static_file != STATIC_DIR:
                self.send_error(403, "Forbidden")
                return
            self.serve_file(static_file)
            return

        self.send_error(404, "Not Found")

    def log_message(self, format: str, *args) -> None:
        return

    def serve_file(self, file_path: Path) -> None:
        if not file_path.exists() or not file_path.is_file():
            self.send_error(404, "Not Found")
            return

        try:
            payload = file_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", get_content_type(file_path))
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except OSError:
            self.send_error(500, "Server Error")


def main() -> None:
    server = HTTPServer((HOST, PORT), RoomSchedulerHandler)
    print(f"Serving on http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
