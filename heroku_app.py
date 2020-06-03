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
import requests

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

#LEELA_SERVER = 'https://ahaux.com/leela_server/'
#KATAGO_SERVER = 'https://ahaux.com/katago_server/'
LEELA_SERVER = 'http://www.ahaux.com/leela_server/'
KATAGO_SERVER = 'http://www.ahaux.com/katago_server/'

#--------------
# Endpoints
#--------------

@app.route('/')
#-------------------------------
def entry_point():
    return app.send_static_file( 'index.html')

@app.route('/index_mobile')
#-------------------------------
def entry_point_mobile():
    return app.send_static_file( 'index_mobile.html')

@app.route('/favicon.ico')
#-------------------------------
def favicon():
    return app.send_static_file( 'favicon.ico')

@app.route('/select-move/<bot_name>', methods=['POST'])
# Forward select-move to the leela server
#------------------------------------------
def select_move( bot_name):
    endpoint = 'select-move/' + bot_name
    args = request.json
    res = fwd_to_leela( endpoint, args)
    return jsonify( res)

@app.route('/katascore/<bot_name>', methods=['POST'])
# Forward score to the katago server
#------------------------------------------
def katascore( bot_name):
    endpoint = 'score/' + bot_name
    args = request.json
    res = fwd_to_katago( endpoint, args)
    return jsonify( res)

@app.route('/nnscore', methods=['POST'])
# Forward nnscore the leela server
#------------------------------------------
def nnscore():
    endpoint = 'nnscore'
    args = request.json
    res = fwd_to_leela( endpoint, args)
    return jsonify( res)

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

#--------------------------------
def get_sgf_tag( sgfstr, tag):
    rexp = r'.*' + tag + r'\[([^\[]*)\].*'
    tstr = sgfstr.decode('utf8')
    res = re.sub(rexp, r'\1', tstr,flags=re.DOTALL)
    if res == tstr: return '' # tag not found
    return res

@app.route('/sgf2list', methods=['POST'])
# Convert sgf main var to coordinate list of moves
#----------------------------------------------------
def sgf2list():
    f = request.files['file']
    sgfstr = f.read()
    RE = get_sgf_tag( sgfstr, 'RE')
    if len(RE) > 10:
        RE = ''
    DT = get_sgf_tag( sgfstr, 'DT')
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
    handicap_setup_done = False
    if sgf.get_handicap() is not None and sgf.get_handicap() != 0:
        for setup in sgf.get_root().get_setup_stones():
            for idx, move in enumerate( setup):
                handicap_setup_done = True
                if idx > 0: moves.append( {'mv':'pass', 'p':'0.00' } )
                moves.append( {'mv':move2coords( move), 'p':'0.00' })

    # Nodes in the main sequence
    for item in sgf.main_sequence_iter():
        color, move_tuple = item.get_move()
        point = None
        if color is not None:
            if move_tuple is not None:
                p = '0.00'
                props = item.get_raw_property_map()
                props = { key.decode(): props[key] for key in props.keys() }
                if 'C' in props:
                    com = props['C'][0].decode()
                    if com.startswith('P:'):
                        p = com.split(':')[1]
                turn = 'w' if len(moves) % 2 else 'b'
                if color != turn: moves.append( {'mv':'pass', 'p':'0.00'})
                moves.append( {'mv':move2coords( move_tuple), 'p':p })
            else:
                moves.append( {'mv':'pass', 'p':'0.00'})
        # Deal with handicap stones as individual nodes
        elif item.get_setup_stones()[0] and not handicap_setup_done:
            move = list( item.get_setup_stones()[0])[0]
            if moves: moves.append( {'mv':'pass', 'p':'0.00'})
            moves.append( {'mv':move2coords( move), 'p':'0.00' })

    probs = [mp['p'] for mp in moves]
    moves = [mp['mv'] for mp in moves]
    return jsonify( {'result': {'moves':moves, 'probs':probs, 'pb':player_black, 'pw':player_white,
                                'winner':winner, 'komi':komi, 'fname':fname, 'RE':RE, 'DT':DT} } )

@app.route('/save-sgf', methods=['GET'])
# Convert moves to sgf and return as file attachment.
# Moves come like 'Q16D4...' to shorten URL.
#-------------------------------------------------------------
def save_sgf():
    pb = request.args.get( 'pb')
    pw = request.args.get( 'pw')
    km = request.args.get( 'km')
    re = request.args.get( 're')
    dt = request.args.get( 'dt')
    meta = { 'pb':pb, 'pw':pw, 'km':km, 're':re, 'dt':dt }
    probs = request.args.get( 'probs', [])
    probs = probs.split(',')
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
    result = moves2sgf( movearr, probs, meta)
    fname = uuid.uuid4().hex[:7] + '.sgf'
    fh = BytesIO( result.encode('utf8'))
    resp = send_file( fh, as_attachment=True, attachment_filename=fname)
    return resp


#----------
# Helpers
#-----------

# Forward request to leela server
#----------------------------------------
def fwd_to_leela( endpoint, args):
    url = LEELA_SERVER + endpoint
    resp = requests.post( url, json=args)
    res = resp.json()
    return res

# Forward request to katago server
#----------------------------------------
def fwd_to_katago( endpoint, args):
    url = KATAGO_SERVER + endpoint
    resp = requests.post( url, json=args)
    res = resp.json()
    return res

# Convert a list of moves like ['Q16',...] to sgf
#---------------------------------------------------
def moves2sgf( moves, probs, meta):
    meta = { k : ('' if v == 'undefined' else v) for (k,v) in meta.items() }
    sgf = '(;FF[4]SZ[19]\n'
    sgf += 'SO[leela-one-playout.herokuapp.com]\n'
    dtstr = meta['dt']
    if not dtstr: dtstr = datetime.now().strftime('%Y-%m-%d')
    km = meta['km']
    if not km: km = '7.5'

    sgf += 'PB[%s]\n' % meta['pb']
    sgf += 'PW[%s]\n' % meta['pw']
    sgf += 'RE[%s]\n' % meta['re']
    sgf += 'KM[%s]\n' % km
    sgf += 'DT[%s]\n' % dtstr

    movestr = ''
    result = ''
    color = 'B'
    for idx,move in enumerate(moves):
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
            if idx < len(probs):
                movestr += 'C[P:%s]' % probs[idx]
        color = othercol

    sgf += result
    sgf += movestr
    sgf += ')'
    return sgf




#----------------------------
if __name__ == '__main__':
    app.run( host='0.0.0.0', port=8000, debug=True)
