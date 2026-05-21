#!/usr/bin/env python3
import http.server, os, sys
os.chdir('/Users/william')
port = int(sys.argv[1]) if len(sys.argv) > 1 else 7821
http.server.test(HandlerClass=http.server.SimpleHTTPRequestHandler, port=port, bind='127.0.0.1')
