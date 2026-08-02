#!/usr/bin/env python3
"""Dev server for the game. Like `python3 -m http.server`, but it does not lie.

The stock handler sends Last-Modified and no Cache-Control, which leaves the
browser to guess how long a file stays fresh. The guess is roughly a tenth of
the file's age, so a script untouched for a fortnight is assumed good for a day
and a half - the browser serves the stale copy without so much as asking. Edit
one file that had been sitting still, reload, and you get the new HTML wired to
last week's JavaScript, which fails as a missing function rather than as
anything that points at caching.

no-store puts a stop to it: every reload fetches every file.

Run:  python3 serve.py [port]
"""

import sys
from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

DEFAULT_PORT = 8000


class NoCacheHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        # A client told no-store should never revalidate, but if one does anyway
        # - a proxy, a stubborn extension - answering 304 would hand it back the
        # stale copy we are trying to get rid of. Drop the validator and serve.
        del self.headers["If-Modified-Since"]
        del self.headers["If-None-Match"]
        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):
        # One line per request is noise; a failure is not.
        if not args or not str(args[1]).startswith("2"):
            super().log_message(fmt, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    handler = partial(NoCacheHandler, directory=str(Path(__file__).parent))
    print(f"http://localhost:{port}  (no-store: every reload gets fresh files)")
    try:
        HTTPServer(("", port), handler).serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
