
/*
 * Main entry point for web_gui Go board
 * AHN Apr 2019
 */

'use strict'

var LEELA_SERVER = ''
var KROKER_RANDOMNESS = 0.5

//==============================
function main( JGO, axutil) {
  $ = axutil.$

  const BOT = 'leela_gtp_bot'
  const BOARD_SIZE = 19
  const COLNAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T']
  const AUTOPLAY_MOVE_DUR_MS = 1000

  var g_jrecord = new JGO.Record(BOARD_SIZE)
  var g_jsetup = new JGO.Setup(g_jrecord.jboard, JGO.BOARD.largeWalnut)
  var g_player = null
  var g_ko = null // ko coordinate
  var g_last_move = null // last move coordinate
  var g_record = null
  var g_complete_record = null
  var g_waiting_for_bot = null
  var g_request_id = ''
  var g_last_x = -1
  var g_last_y = -1
  var g_last_hover = false

  set_btn_handlers()
  reset_game()
  setup_jgo()
  document.onkeydown = check_key

  //================
  // UI Callbacks
  //================

  //-------------------------
  function setup_jgo() {
    g_jsetup.setOptions({stars: {points:9}})
    // Add mouse event listeners for the board
    //------------------------------------------
    g_jsetup.create('board',
      function(canvas) {
        //----------------------------
        canvas.addListener('click',
          function(coord, ev) {
            var jboard = g_jrecord.jboard
            if ((jboard.getType(coord) == JGO.BLACK) || (jboard.getType(coord) == JGO.WHITE)) { return }
            if (g_waiting_for_bot) {
              return
            }
            if (score_position.active) {
              goto_move( g_record.length)
              score_position.active = false
              return
            }
            // clear hover away
            if (g_last_hover) { jboard.setType(new JGO.Coordinate( g_last_x, g_last_y), JGO.CLEAR) }
            g_last_hover = false

            // Click on empty board resets everything
            if (g_record.length == 0) {
              reset_game()
            }

            // Add the new move
            maybe_start_var()
            var mstr = jcoord2string( coord)
            g_complete_record = g_record.slice()
            g_complete_record.push( {'mv':mstr, 'p':0.0} )
            goto_move( g_complete_record.length)
            get_prob( function() { botmove_if_active() }, true )
            //botmove_if_active()
          }
        ) // click

        //------------------------------
        canvas.addListener('mousemove',
          function(coord, ev) {
            var jboard = g_jrecord.jboard
            if(coord.i == -1 || coord.j == -1 || (coord.i == g_last_x && coord.j == g_last_y))
              return

            if (g_last_hover) // clear previous hover if there was one
              jboard.setType(new JGO.Coordinate( g_last_x, g_last_y), JGO.CLEAR)

            g_last_x = coord.i
            g_last_y = coord.j

            if (jboard.getType( coord) == JGO.CLEAR && jboard.getMark( coord) == JGO.MARK.NONE) {
              jboard.setType( coord, g_player == JGO.WHITE ? JGO.DIM_WHITE : JGO.DIM_BLACK)
              g_last_hover = true
            }
            else {
              g_last_hover = false
            }
          }
        ) // mousemove

        //----------------------------
        canvas.addListener('mouseout',
          function(ev) {
            var jboard = g_jrecord.jboard
            if (g_last_hover)
              jboard.setType(new JGO.Coordinate( g_last_x, g_last_y), JGO.CLEAR);

            g_last_hover = false;
          }
        ) // mouseout
      } // function(canvas)
    ) // create board
  } // setup_jgo()

  // Set button callbacks
  //------------------------------
  function set_btn_handlers() {
    set_load_sgf_handler()
    var_button_state( 'off')

    $('#btn_clear_var').click( () => {
      if ($('#btn_clear_var').hasClass('disabled')) { return }
      handle_variation( 'clear')
    })

    $('#btn_accept_var').click( () => {
      if ($('#btn_accept_var').hasClass('disabled')) { return }
      handle_variation( 'accept')
    })

    $('#btn_leela').click( () => {
      set_emoji()
      if (g_record.length == 0) {
        reset_game()
      }
      $('#histo').hide()
      activate_bot( 'leela')
      $('#status').html( 'Leela is thinking...')
      get_bot_move()
      return false
    })

    $('#btn_kroker').click( () => {
      set_emoji()
      if (g_record.length == 0) {
        reset_game()
      }
      $('#histo').hide()
      activate_bot( 'kroker')
      $('#status').html( 'Kroker is thinking...')
      get_bot_move( KROKER_RANDOMNESS)
      return false
    })

    $('#btn_prob').click( () => {
      $('#histo').hide()
      $('#status').html( 'thinking...')
      get_prob()
      return false
    })

    $('#btn_save').click( () => {
      var rec = moves_only(g_complete_record)
      // Kludge to manage passes
      for (var i=0; i < rec.length; i++) {
        if (rec[i] == 'pass') { rec[i] = 'A0' }
      }
      var moves = rec.join('')
      if (moves.length == 0) { return }
      var url = '/save-sgf?q=' + Math.random + '&moves=' + moves
      window.location.href = url
    })

    $('#btn_nnscore').click( () => {
      score_position( 'nnscore')
      $('#histo').show()
      return false
    })

    $('#btn_pass').click( () => {
      g_complete_record = g_record.slice()
      g_complete_record.push( {'mv':'pass', 'p':0.0} )
      goto_move( g_complete_record.length)
      //get_prob()
      botmove_if_active()
    })

    $('#btn_undo').click( () => { $('#histo').hide(); goto_move( g_record.length - 1); g_complete_record = g_record; activate_bot('') })
    $('#btn_prev').click( () => { $('#histo').hide(); goto_move( g_record.length - 1); activate_bot('') })
    $('#btn_next').click( () => { $('#histo').hide(); goto_move( g_record.length + 1); activate_bot('') })
    $('#btn_back10').click( () => { $('#histo').hide(); goto_move( g_record.length - 10); activate_bot('') })
    $('#btn_fwd10').click( () => { $('#histo').hide(); goto_move( g_record.length + 10); activate_bot('') })
    $('#btn_first').click( () => { $('#histo').hide(); goto_first_move(); activate_bot(''); $('#status').html( '&nbsp;') })
    $('#btn_last').click( () => { $('#histo').hide(); goto_move( g_complete_record.length); activate_bot('') })

    // Prevent zoom on double tap
    $('#btn_clear_var').on('touchstart', prevent_zoom)
    $('#btn_accept_var').on('touchstart', prevent_zoom)
    $('#btn_leela').on('touchstart', prevent_zoom)
    $('#btn_kroker').on('touchstart', prevent_zoom)
    $('#btn_prob').on('touchstart', prevent_zoom)
    $('#btn_save').on('touchstart', prevent_zoom)
    $('#btn_nnscore').on('touchstart', prevent_zoom)
    $('#btn_pass').on('touchstart', prevent_zoom)
    $('#btn_undo').on('touchstart', prevent_zoom)
    $('#btn_prev').on('touchstart', prevent_zoom)
    $('#btn_next').on('touchstart', prevent_zoom)
    $('#btn_back10').on('touchstart', prevent_zoom)
    $('#btn_fwd10').on('touchstart', prevent_zoom)
    $('#btn_first').on('touchstart', prevent_zoom)
    $('#btn_last').on('touchstart', prevent_zoom)
    $('#btn_again').on('touchstart', prevent_zoom)
  } // set_btn_handlers()

  // Load Sgf button
  //-----------------------------------
  function set_load_sgf_handler() {
    $('#sgf-file').on('change', function() {
      var input = $(this)
      var myfile = input.get(0).files[0]
      var numFiles = input.get(0).files ? input.get(0).files.length : 1
      var label = input.val().replace(/\\/g, '/').replace(/.*\//, '')
      // Call API to get the moves, then replay on the board
      axutil.hit_endpoint( '/sgf2list' + '?tt=' + Math.random(), myfile, (response) => {
        var res = response.result
        var moves = res.moves
        set_emoji()
        replay_move_list( moves)
        g_complete_record = g_record.slice()
        show_movenum()
        //g_record_pos = g_complete_record.length
        //var winner = res.winner.toUpperCase()
        var komi = res.komi
        // Game Info
        $('#game_info').html( `B:${res.pb} &nbsp;&nbsp; W:${res.pw} &nbsp;&nbsp; Result:${res.RE} &nbsp;&nbsp; Komi:${komi}`)
        $('#fname').html( res.fname)
      })
    }) // $('sgf-file')
  } // set_load_sgf_handler()

  // Arrow key actions
  //------------------------
  function check_key(e) {
    e = e || window.event;
    if (e.keyCode == '38') { // up arrow
    }
    else if (e.keyCode == '40') { // down arrow
    }
    else if (e.keyCode == '37') { // left arrow
      activate_bot('')
      goto_move( g_record.length - 1)
    }
    else if (e.keyCode == '39') { // right arrow
      activate_bot('')
      goto_move( g_record.length + 1)
    }
  } // check_key()

  // Prevent double taps from zooming in on mobile devices.
  // Use like btn.addEventListener('touchstart', prevent_zoom)
  //------------------------------------------------------------
  function prevent_zoom(e) {
    var t2 = e.timeStamp
    var t1 = e.currentTarget.dataset.lastTouch || t2
    var dt = t2 - t1
    //var fingers = e.touches.length
    e.currentTarget.dataset.lastTouch = t2
    //if (!dt || dt > 500 || fingers > 1) return
    e.preventDefault()
    e.target.click()
  } // prevent_zoom()

  //===================
  // Bot Interaction
  //===================

  //--------------------------------
  function botmove_if_active() {
    if (g_waiting_for_bot) { return true }
    if (activate_bot.botname == 'leela') {
      $('#status').html( 'Leela is thinking...')
      get_bot_move()
      return true
    }
    else if (activate_bot.botname == 'kroker') {
      $('#status').html( 'Kroker is thinking...')
      get_bot_move( KROKER_RANDOMNESS)
      return true
    }
    return false
  } // botmove_if_active()

  // Get next move from the bot and show on board
  //-------------------------------------------------
  function get_bot_move( kroker_randomness) {
    if (!kroker_randomness) {
      kroker_randomness = 0.0
    }
    //console.log( g_record)
    if (g_waiting_for_bot) {
      console.log( 'still waiting')
      return
    }
    g_waiting_for_bot = true
    g_request_id = Math.random() + ''
    axutil.hit_endpoint( LEELA_SERVER + '/select-move/' + BOT + '?tt=' + Math.random(), {'board_size': BOARD_SIZE, 'moves': moves_only(g_record),
      'config':{'randomness': kroker_randomness, 'request_id': g_request_id } },
      (data) => {
        if (!g_waiting_for_bot) { return }
        //console.log( 'req id: ' + data.request_id + ' ' + g_request_id)
        if (data.request_id != g_request_id) { return }
        //$('#status').html( 'P(B wins): ' + parseFloat(data.diagnostics.winprob).toFixed(4))
        if (g_last_hover) { // the board thinks the hover stone is actually there. Ouch.
          g_jrecord.jboard.setType(new JGO.Coordinate( g_last_x, g_last_y), JGO.CLEAR)
          g_last_hover = false
        }

        if (data.bot_move == 'pass') {
          alert( 'The bot passes. Click on the Score button.')
        }
        else if (data.bot_move == 'resign' || data.diagnostics.winprob > 0.996) {
          alert( 'The bot resigns. You beat the bot!')
        }
        else {
          maybe_start_var()
          var botCoord = string2jcoord( data.bot_move)
        }
        show_move( g_player, botCoord, 0.0)
        g_complete_record = g_record.slice()
        show_movenum()
        g_player =  (g_player == JGO.BLACK) ? JGO.WHITE : JGO.BLACK
        g_waiting_for_bot = false
        get_prob()
      })
  } // get_bot_move()

  //--------------------------------
  function activate_bot( botname) {
    activate_bot.botname = botname
    if (botname == 'leela') {
      $('#btn_kroker').css('background-color', '#CCCCCC')
      $('#btn_leela').css('background-color', '#EEEEEE')
    }
    else if (botname == 'kroker') {
      $('#btn_kroker').css('background-color', '#EEEEEE')
      $('#btn_leela').css('background-color', '#CCCCCC')
    }
    else {
      g_waiting_for_bot = false
      $('#btn_leela').css('background-color', '#CCCCCC')
      $('#btn_kroker').css('background-color', '#CCCCCC')
    }
  } // activate_bot()
  activate_bot.botname = ''

  //========
  // Moves
  //========

  // Show a move on the board and append it to g_record
  //------------------------------------------------------
  function show_move(player, coord, prob) {
    if (coord == 'pass' || coord == 'resign') {
      g_ko = false
      g_record.push( { 'mv':coord, 'p':prob } )
      return
    }
    var play = g_jrecord.jboard.playMove( coord, player, g_ko)
    if (play.success) {
      g_record.push( { 'mv':jcoord2string( coord), 'p':prob } )
      var node = g_jrecord.createNode( true)
      node.info.captures[player] += play.captures.length // tally captures
      node.setType( coord, player) // play stone
      node.setType( play.captures, JGO.CLEAR) // clear opponent's stones

      if (g_last_move) {
        node.setMark( g_last_move, JGO.MARK.NONE) // clear previous mark
      }
      if (g_ko) {
        node.setMark( g_ko, JGO.MARK.NONE) // clear previous ko mark
      }
      node.setMark( coord, JGO.MARK.CIRCLE) // mark move
      g_last_move = coord

      if(play.ko)
        node.setMark (play.ko, JGO.MARK.CIRCLE) // mark ko, too
      g_ko = play.ko
    }
    else {
      var tstr = player + coord
      var node = g_jrecord.getCurrentNode()
      node.setMark( coord, JGO.MARK.SQUARE)
      alert( 'Illegal move: ' + play.errorMsg + ' ' + tstr)
    }
  } // show_move()

  //------------------------
  function goto_first_move() {
    g_player = JGO.BLACK
    g_ko = false
    g_last_move = false
    g_record = []
    g_waiting_for_bot = false
    g_jrecord.jboard.clear()
    g_jrecord.root = g_jrecord.current = null
    show_movenum()
    set_emoji()
  } // goto_first_move()

  //-----------------------
  function reset_game() {
    handle_variation( 'clear')
    goto_first_move()
    g_complete_record = []
  } // reset_game()

  // Replay game from empty board.
  //------------------------------------
  function replay_move_list( mlist) {
    goto_first_move()
    for (var move_prob of mlist) {
      if (typeof move_prob == 'string') {
        move_prob = { 'mv':move_prob, 'p':0.0 }
      }
      var move_string = move_prob.mv
      var coord = string2jcoord( move_string)
      show_move( g_player, coord, move_prob.p)
      g_player =  (g_player == JGO.BLACK) ? JGO.WHITE : JGO.BLACK
    } // for
  } // replay_move_list()

  // Replay and show game up to move n
  //-------------------------------------
  function goto_move( n) {
    var totmoves = g_complete_record.length
    if (n > totmoves) { n = totmoves }
    if (n < 1) { goto_first_move(); return }
    var record = g_complete_record.slice( 0, n)
    replay_move_list( record)
    show_movenum()
    show_prob()
    update_emoji()
  } // goto_move()

  //----------------------------
  function show_movenum() {
    if (!g_complete_record) { return }
    var totmoves = g_complete_record.length
    var n = g_record.length
    $('#movenum').html( `${n} / ${totmoves}`)
  } // show_movenum()

  //======================
  // Variation handling
  //======================

  // Make a variation, or restore from var, or forget var
  //--------------------------------------------------------
  function handle_variation( action) {
    if (action == 'save') { // Save record and start a variation
      handle_variation.var_backup = g_complete_record
      handle_variation.var_pos = g_record.length + 1
      var_button_state('on')
    }
    else if (action == 'clear') { // Restore game record and forget the variation
      if (handle_variation.var_backup) {
        g_complete_record = handle_variation.var_backup
        g_record = g_complete_record.slice( 0, handle_variation.var_pos)
        goto_move( g_record.length)
        handle_variation.var_backup = null
        var_button_state('off')
        $('#status').html( 'Variation deleted')
      }
    }
    else if (action == 'accept') { // Forget saved game record and replace it with the variation
      handle_variation.var_backup = null
      var_button_state( 'off')
      $('#status').html( 'Variation accepted')
    }
  } // handle_variation()
  handle_variation.var_backup = null
  handle_variation.var_pos = 0

  // Start a variation if we're not at the end
  //---------------------------------------------
  function maybe_start_var() {
    if (g_complete_record && g_record.length < g_complete_record.length) {
      if (!handle_variation.var_backup) { // we are not in a variation, make one
        handle_variation( 'save')
      }
    }
  } // maybe_start_var()

  //-------------------------------------------
  function var_button_state( state) {
    if (!state) {
      if ($('#btn_clear_var').hasClass('disabled')) {
        return 'off'
      }
      else {
        return 'on'
      }
    }
    if (state == 'on') {
      $('#btn_clear_var').removeClass('disabled')
      $('#btn_clear_var').addClass('btn-danger')
      $('#btn_accept_var').removeClass('disabled')
      $('#btn_accept_var').addClass('btn-success')
      $('#btn_clear_var').css('color', 'black');
      $('#btn_accept_var').css('color', 'black');
    }
    else {
      $('#btn_clear_var').addClass('disabled')
      $('#btn_clear_var').removeClass('btn-danger')
      $('#btn_accept_var').addClass('disabled')
      $('#btn_accept_var').removeClass('btn-success')
      $('#btn_clear_var').css('color', 'black');
      $('#btn_accept_var').css('color', 'black');
    }
  } // var_button_state()

  //======================
  // Winning probability
  //======================

  // Get current winning probability.
  //--------------------------------------------
  function get_prob( completion, update_emo) {
    g_waiting_for_bot = true
    axutil.hit_endpoint( LEELA_SERVER + '/select-move/' + BOT + '?tt=' + Math.random(),
      {'board_size': BOARD_SIZE, 'moves': moves_only(g_record), 'config':{'randomness': 0.0, 'request_id': 0 } },
      (data) => {
        g_waiting_for_bot = false
        var p = parseFloat(data.diagnostics.winprob)
        g_record[ g_record.length - 1].p = p // Remember win prob of position
        g_complete_record[ g_record.length - 1].p = p
        show_prob( update_emo)
        if (completion) { completion(); }
      })
  } // get_prob()

  //---------------------------------
  function show_prob( update_emo) {
    var n = g_record.length - 1
    var p = g_record[n].p
    if (p == 0) {
      set_emoji(); $('#status').html('')
      return
    }
    $('#status').html( 'P(B wins): ' + p.toFixed(4))
    // Show emoji
    if (update_emo) { update_emoji() }
  } // show_prob()

  //--------------------------
  function update_emoji() {
    var n = g_record.length - 1
    var p = g_record[n].p
    if (p == 0) { set_emoji(); return }
    if (p < 0.05) { set_emoji(1.0); return } // angry
    if (n > 0) {
      if (g_record[n].mv == 'pass') {  set_emoji(); return }
      if (g_record[n-1].mv == 'pass') {  set_emoji(); return }
      var pp = g_record[n-1].p
      if (pp == 0) { set_emoji(); return }
      if (n % 2) { // we are white
        p = 1.0 - p; pp = 1.0 - pp
      }
      set_emoji( pp - p)
    }
  } // update_emoji()

  //----------------------------------
  function set_emoji( delta_prob) {
    var emo_id = '#emo'
    //if (g_record.length % 2) { emo_id = '#w_emo' }
    if (typeof delta_prob == 'undefined') {
      $(emo_id).html( '&nbsp;')
      return
    }
    const MOVE_EMOJI = ['🙂','😐','😒','😡']
    const PROB_BINS = [0.02, 0.05, 0.1]
    var emo = MOVE_EMOJI[3]
    for (var i=0; i < PROB_BINS.length; i++) {
      if (delta_prob < PROB_BINS[i]) {
        emo = MOVE_EMOJI[i]; break;
      }
    }
    $(emo_id).html( '&nbsp;' + emo)
  } // set_emoji()

  //==========
  // Scoring
  //==========

  // Score the current position. Endpoint is 'score' or 'nnscore'.
  //----------------------------------------------------------------
  function score_position( endpoint)
  {
    if (g_waiting_for_bot) {
      console.log( 'still waiting')
      return
    }
    axutil.hit_endpoint( LEELA_SERVER + endpoint + '?tt=' + Math.random(), {'board_size': BOARD_SIZE, 'moves': moves_only(g_record)},
      (data) => {
        plot_histo(data, (surepoints) => {
          if (surepoints < 120) {
            alert( 'Too early to score. Sorry.')
            return
          }
          score_position.active = true
          var node = g_jrecord.createNode( true)
          for (var bpoint of data.territory.black_points) {
            var coord = rc2jcoord( bpoint[0], bpoint[1])
            if (node.jboard.stones [coord.i] [coord.j] != 1) {
              node.setMark( rc2jcoord( bpoint[0], bpoint[1]), JGO.MARK.BLACK_TERRITORY)
            }
          }
          for (var wpoint of data.territory.white_points) {
            var coord = rc2jcoord( wpoint[0], wpoint[1])
            if (node.jboard.stones [coord.i] [coord.j] != 2) {
              node.setMark( rc2jcoord( wpoint[0], wpoint[1]), JGO.MARK.WHITE_TERRITORY)
            }
          }
          for (var dpoint of data.territory.dame_points) {
            node.setMark( rc2jcoord( dpoint[0], dpoint[1]), JGO.MARK.TRIANGLE)
          }
          var black_points = data.result[0]
          var white_points = data.result[1]
          var diff = Math.abs( black_points - white_points)
          var rstr = `W+${diff} <br>(before komi and handicap)`
          if (black_points >= white_points) { rstr = `B+${diff}  <br>(before komi and handicap)` }
          $('#status').html( `Black:${black_points} &emsp; White:${white_points} &emsp; ${rstr}`)
        }) // plot_histo()
      } // (data) =>
    ) // hit_endpoint()
  } // score_position()
  score_position.active = false

  //===============
  // Converters
  //===============

  // Record has pairs (mv,p). Turn into a list of mv.
  //---------------------------------------------------
  function moves_only( record) {
    var res = []
    for (var move_prob of record) {
      res.push( move_prob.mv)
    }
    return res
  } // moves_only()

  //--------------------------------------
  function jcoord2string( jgo_coord) {
    if (jgo_coord == 'pass' || jgo_coord == 'resign') { return jgo_coord }
    var row = (BOARD_SIZE - 1) - jgo_coord.j
    var col = jgo_coord.i
    return COLNAMES[col] + ((row + 1).toString())
  } // jcoord2string()

  //--------------------------------------
  function string2jcoord( move_string) {
    if (move_string == 'pass' || move_string == 'resign') { return move_string }
    var colStr = move_string.substring(0, 1)
    var rowStr = move_string.substring(1)
    var col = COLNAMES.indexOf(colStr)
    var row = BOARD_SIZE - parseInt(rowStr, 10)
    return new JGO.Coordinate(col, row)
  } // string2jcoord()

  // Turn a server (row, col) into a JGO coordinate
  //-------------------------------------------------------
  function rc2jcoord( row, col) {
    return new JGO.Coordinate( col - 1, BOARD_SIZE - row)
  } // rc2jcoord()

  //=======
  // Misc
  //=======

  // Plot histogram of territory probabilities
  //---------------------------------------------
  function plot_histo( data, completion) {
    var wp = data.white_probs
    axutil.hit_endpoint( '/histo'  + '?tt=' + Math.random() , [wp,20,0,1], (res) => {
      var surepoints = res[0][1] + res[res.length-1][1]
      axutil.barchart( '#histo', res, 240)
      completion( surepoints)
    })
  } // plot_histo()

} // function main()
