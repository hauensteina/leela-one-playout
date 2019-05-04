#!/usr/bin/env python

# /********************************************************************
# Filename: 05_leela_heroku/leela-one-playout/heroku_app.py
# Author: AHN
# Creation Date: Apr, 2019
# **********************************************************************/
#
# A web interface for Go experiments. Adapted from dlgo.
# Only a frontend, the bots run elsewhere and are accessed via an API.
#

from pdb import set_trace as BP
import os, sys, re
import numpy as np
from datetime import datetime
import uuid
from io import BytesIO

import flask
from flask import jsonify,request,Response,send_file,Flask

from gotypes import Point
from sgf import Sgf_game
from go_utils import coords_from_point, point_from_coords
import goboard_fast as goboard

here = os.path.dirname( __file__)
static_path = os.path.join( here, 'static')
app = Flask( __name__, static_folder=static_path, static_url_path='/static')

app.config.update(
    DEBUG = True,
    SECRET_KEY = 'secret_xxx'
)

# This gives you decent error messages in the browser
app.config['DEBUG'] = os.getenv("DEBUG", False)
app.config['MAX_CONTENT_LENGTH'] = 1 * 1024 * 1024


# @app.after_request
# #---------------------
# def add_header(r):
#     # No caching
#     r.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
#     r.headers["Pragma"] = "no-cache"
#     r.headers["Expires"] = "0"
#     r.headers['Cache-Control'] = 'public, max-age=0'
#     return r

#--------------
# Endpoints
#--------------

@app.route('/')
#-------------------------------
def entry_point():
    return app.send_static_file('index.html')
    # html = open('static/index.html').read()
    # return html

@app.route('/histo', methods=['POST'])
# Take a bunch of numbers, number of bins, min, max and return a histo.
#------------------------------------------------------------------------
def histo():
    data,nbins,mmin,mmax = request.json
    counts,borders = np.histogram( data, nbins, [mmin, mmax])
    counts = counts.tolist()
    borders = borders.tolist()
    centers = [ (borders[i] + borders[i+1]) / 2.0 for i in range(len(borders)-1) ]
    res = list(zip( centers, counts))
    return jsonify( res)

@app.route('/sgf2list', methods=['POST'])
# Convert sgf main var to coordinate list of moves
#----------------------------------------------------
def sgf2list():
    f = request.files['file']
    sgfstr = f.read()
    sgf = Sgf_game.from_string( sgfstr)
    player_white = sgf.get_player_name('w')
    player_black = sgf.get_player_name('b')
    winner = sgf.get_winner()
    komi = sgf.get_komi()
    fname = f.filename

    res = {}
    moves = []

    #------------------------
    def move2coords( move):
        row, col = move
        p = Point( row + 1, col + 1)
        coords = coords_from_point( p)
        return coords

    # Deal with handicap in the root node
    if sgf.get_handicap() is not None and sgf.get_handicap() != 0:
        for setup in sgf.get_root().get_setup_stones():
            for idx, move in enumerate( setup):
                if idx > 0: moves.append( 'pass')
                moves.append( move2coords( move))

    # Nodes in the main sequence
    for item in sgf.main_sequence_iter():
        color, move_tuple = item.get_move()
        point = None
        if color is not None:
            if move_tuple is not None:
                moves.append( move2coords( move_tuple))
            else:
                moves.append( 'pass')
        # Deal with handicap stones as individual nodes
        elif item.get_setup_stones()[0]:
            move = list( item.get_setup_stones()[0])[0]
            if moves: moves.append( 'pass')
            moves.append( move2coords( move))

    return jsonify( {'result': {'moves':moves, 'pb':player_black, 'pw':player_white,
                                'winner':winner, 'komi':komi, 'fname':fname} } )

# Convert a list of moves like ['Q16',...] to sgf
#---------------------------------------------------
def moves2sgf( moves):
    sgf = '(;FF[4]SZ[19]\n'
    sgf += 'SO[leela-one-playout.herokuapp.com]\n'
    dtstr = datetime.now().strftime('%Y-%m-%d')
    sgf += 'DT[%s]\n' % dtstr

    movestr = ''
    result = ''
    color = 'B'
    for move in moves:
        othercol = 'W' if color == 'B' else 'B'
        if move == 'resign':
            result = 'RE[%s+R]' % othercol
        elif move == 'pass':
            movestr += ';%s[tt]' % color
        elif move == 'A0':
            movestr += ';%s[tt]' % color
        else:
            #BP()
            p = point_from_coords( move)
            col_s = 'abcdefghijklmnopqrstuvwxy'[p.col - 1]
            row_s = 'abcdefghijklmnopqrstuvwxy'[19 - p.row]
            movestr += ';%s[%s%s]' % (color,col_s,row_s)
        color = othercol

    sgf += result
    sgf += movestr
    sgf += ')'
    return sgf

@app.route('/save-sgf', methods=['GET'])
# Convert moves to sgf and return as file attachment.
# Moves come like 'Q16D4...' to shorten URL.
#-------------------------------------------------------------
def save_sgf():
    moves = request.args.get( 'moves')
    movearr = []
    m = ''
    for c in moves:
        if c > '9': # a letter
            if m: movearr.append(m)
            m = c
        else:
            m += c
    if m: movearr.append(m)
    result = moves2sgf( movearr)
    fname = uuid.uuid4().hex + '.sgf'
    fh = BytesIO( result.encode('utf8'))
    resp = send_file( fh, as_attachment=True, attachment_filename=fname)
    return resp




#----------------------------
if __name__ == '__main__':
    app.run( host='0.0.0.0', port=8000, debug=True)
