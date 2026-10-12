#!/usr/bin/env python3
"""Serveur local de PatchFlow : python3 serve.py [port]  ->  http://127.0.0.1:7821/app.html"""
import http.server, os, sys
os.chdir(os.path.dirname(os.path.abspath(__file__)))
port = int(sys.argv[1]) if len(sys.argv) > 1 else 7821
http.server.test(HandlerClass=http.server.SimpleHTTPRequestHandler, port=port, bind='127.0.0.1')
