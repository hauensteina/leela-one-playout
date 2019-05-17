
/*
 * Main entry point for web_gui Go board
 * AHN Apr 2019
 */

'use strict'

//var LEELA_SERVER = 'http://ahaux.com:2718/' // test
var LEELA_SERVER = 'https://ahaux.com/leela_server/' // prod
var KROKER_RANDOMNESS = 0.5


//==============================
function main( JGO, axutil) {
  $ = axutil.$

  const BOT = 'leela_gtp_bot'
  //const BOT = 'smartrandom'
  //const BOT = 'leelabot'
  const BOARD_SIZE = 19
  const COLNAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T']
  const AUTOPLAY_MOVE_DUR_MS = 1000

  var g_jrecord = new JGO.Record(BOARD_SIZE)
  var g_jsetup = new JGO.Setup(g_jrecord.jboard, JGO.BOARD.largeWalnut)
  var g_player = null
  var g_ko = null // ko coordinate
  var g_lastMove = null // last move coordinate
  var g_record = null
  var g_complete_record = null
  //var g_record_pos = 0
  var g_timer = null
  var g_waiting_for_bot = null
  var g_request_id = ''
  var g_last_x = -1
  var g_last_y = -1
  var g_last_hover = false
  var g_cur_btn = '#btn_prev'

  resetGame()
  set_btn_handlers()
  setup_jgo()
  set_upload_sgf_handler()
  document.onkeydown = checkKey

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
            if (scorePosition.active) {
              gotoMove( g_record.length)
              scorePosition.active = false
              return
            }
            // clear hover away
            if (g_last_hover) { jboard.setType(new JGO.Coordinate( g_last_x, g_last_y), JGO.CLEAR) }
            g_last_hover = false

            // Add the new move
            var mstr = coordsToString( coord)
            if (g_complete_record && g_record.length < g_complete_record.length) { // we are not at the end
              if (!handle_variation.var_backup) { // we are not in a variation, make one
                handle_variation( 'save')
              }
            }

            g_complete_record = g_record.slice()
            g_complete_record.push( mstr)
            gotoMove( g_complete_record.length)
            botmove_if_active()
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

  //-----------------------------------
  function set_upload_sgf_handler() {
    $('#sgf-file').on('change', function() {
      var input = $(this)
      var myfile = input.get(0).files[0]
      var numFiles = input.get(0).files ? input.get(0).files.length : 1
      var label = input.val().replace(/\\/g, '/').replace(/.*\//, '')
      // Call API to get the moves, then replay on the board
      axutil.hit_endpoint( '/sgf2list', myfile, (response) => {
        var res = response.result
        var moves = res.moves
        replayMoveList( moves)
        g_complete_record = g_record.slice()
        //g_record_pos = g_complete_record.length
        var winner = res.winner.toUpperCase()
        var komi = res.komi
        // Game Info
        $('#game_info').html( `B:${res.pb} &nbsp;&nbsp; W:${res.pw} &nbsp;&nbsp; Winner:${winner} &nbsp;&nbsp; Komi:${komi}`)
        $('#fname').html( res.fname)
        set_again( '#btn_prev')
      })
    }) // $('sgf-file')
  } // set_upload_sgf_handler()

  // Make a variation, or restore from var, or forget var
  //--------------------------------------------------------
  function handle_variation( action) {
    if (action == 'save') { // Save record and start a variation
      handle_variation.var_backup = g_complete_record
      handle_variation.var_pos = g_record.length
      var_button_state('on')
    }
    else if (action == 'clear') { // Restore game record and forget the variation
      if (handle_variation.var_backup) {
        g_complete_record = handle_variation.var_backup
        g_record = g_complete_record.slice( 0, handle_variation.var_pos)
        gotoMove( g_record.length)
        handle_variation.var_backup = null
        var_button_state('off')
        alert( 'Variation discarded')
      }
    }
    else if (action == 'accept') { // Forget saved game record and replace it with the variation
      handle_variation.var_backup = null
      var_button_state( 'off')
      alert( 'Variation is now the main line')
    }
  } // handle_variation()
  handle_variation.var_backup = null
  handle_variation.var_pos = 0

  //------------------------
  function resetGame() {
    // Instantiate globals
    g_player = JGO.BLACK // next player
    g_ko = false
    g_lastMove = false
    g_record = []
    //g_record_pos = 0
    g_timer = null
    g_waiting_for_bot = false

    // Clear things
    g_jrecord.jboard.clear()
    g_jrecord.root = g_jrecord.current = null
    //g_jrecord.info = {}
  } // resetGame()

  //--------------------------------
  function coordsToString(point) {
    var row = (BOARD_SIZE - 1) - point.j
    var col = point.i
    return COLNAMES[col] + ((row + 1).toString())
  } // coordsToString()

  //--------------------------------------
  function stringToCoords(move_string) {
    var colStr = move_string.substring(0, 1)
    var rowStr = move_string.substring(1)
    var col = COLNAMES.indexOf(colStr)
    var row = BOARD_SIZE - parseInt(rowStr, 10)
    return new JGO.Coordinate(col, row)
  } // stringToCoords()

  //----------------------------------
  function addMove( movestr) {
    g_record.push( movestr)
    //g_record_pos = g_record.length
  }

  //-----------------------------------
  function applyMove(player, coord) {
    //console.log( player)
    //console.log( coord)
    var play = g_jrecord.jboard.playMove( coord, player, g_ko)

    if (play.success) {
      addMove( coordsToString( coord))
      var node = g_jrecord.createNode( true)
      node.info.captures[player] += play.captures.length // tally captures
      node.setType( coord, player) // play stone
      node.setType( play.captures, JGO.CLEAR) // clear opponent's stones

      if (g_lastMove) {
        node.setMark( g_lastMove, JGO.MARK.NONE) // clear previous mark
      }
      if (g_ko) {
        node.setMark( g_ko, JGO.MARK.NONE) // clear previous ko mark
      }
      node.setMark( coord, JGO.MARK.CIRCLE) // mark move
      g_lastMove = coord

      if(play.ko)
        node.setMark (play.ko, JGO.MARK.CIRCLE) // mark ko, too
      g_ko = play.ko
    }
    else {
      clearInterval( g_timer)
      var tstr = player + coord
      var node = g_jrecord.getCurrentNode()
      node.setMark( coord, JGO.MARK.SQUARE)
      alert( 'Illegal move: ' + play.errorMsg + ' ' + tstr)
    }
  } // applyMove()

  // Get next move from the bot and show on board
  //---------------------------------------------------------
  function getBotMove( prob_only_flag, kroker_randomness) {
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
    axutil.hit_endpoint( LEELA_SERVER + '/select-move/' + BOT, {'board_size': BOARD_SIZE, 'moves': g_record,
      'config':{'randomness': kroker_randomness, 'request_id': g_request_id } },
      (data) => {
        if (!g_waiting_for_bot) { return }
        //console.log( 'req id: ' + data.request_id + ' ' + g_request_id)
        if (data.request_id != g_request_id) { return }
        $('#status').html( 'P(B wins): ' + parseFloat(data.diagnostics.winprob).toFixed(4))
        if (g_last_hover) { // the board thinks the hover stone is actually there. Ouch.
          g_jrecord.jboard.setType(new JGO.Coordinate( g_last_x, g_last_y), JGO.CLEAR)
          g_last_hover = false
        }

        if (!prob_only_flag) {
          if (data.bot_move == 'pass') {
            addMove( data.bot_move)
            g_ko = false
            alert( 'The bot passes. Click on the Score button.')
          }
          else if (data.bot_move == 'resign' || data.diagnostics.winprob > 0.996) {
            addMove( data.bot_move)
            g_ko = false
            alert( 'The bot resigns. You beat the bot!')
          }
          else {
            var botCoord = stringToCoords( data.bot_move)
            applyMove( g_player, botCoord)
          }
          g_player =  (g_player == JGO.BLACK) ? JGO.WHITE : JGO.BLACK
          g_complete_record = g_record.slice()
          //g_record_pos = g_complete_record.length
          g_waiting_for_bot = false
          var prob_only = true
          getBotMove( prob_only)
        }
        else { // if prob_only_flag
          g_waiting_for_bot = false
        }
      })
  } // getBotMove()

  // Turn a server (row, col) into a JGO coordinate
  //---------------------------------------------------
  function rc2Jgo( row, col) {
    return new JGO.Coordinate( col - 1, BOARD_SIZE - row)
  } // rc2Jgo()

  // Score the current position. Endpoint is 'score' or 'nnscore'.
  //----------------------------------------------------------------
  function scorePosition( endpoint)
  {
    if (g_waiting_for_bot) {
      console.log( 'still waiting')
      return
    }
    axutil.hit_endpoint( LEELA_SERVER + endpoint, {'board_size': BOARD_SIZE, 'moves': g_record},
      (data) => {
        plot_histo(data, (surepoints) => {
          if (surepoints < 120) {
            alert( 'Too early to score. Sorry.')
            return
          }
          scorePosition.active = true
          var black_points = 0
          var white_points = 0
          var node = g_jrecord.createNode( true)
          for (var bpoint of data.territory.black_points) {
            black_points += 1
            var coord = rc2Jgo( bpoint[0], bpoint[1])
            if (node.jboard.stones [coord.i] [coord.j] != 1) {
              node.setMark( rc2Jgo( bpoint[0], bpoint[1]), JGO.MARK.BLACK_TERRITORY)
            }
          }
          for (var wpoint of data.territory.white_points) {
            white_points += 1
            var coord = rc2Jgo( wpoint[0], wpoint[1])
            if (node.jboard.stones [coord.i] [coord.j] != 2) {
              node.setMark( rc2Jgo( wpoint[0], wpoint[1]), JGO.MARK.WHITE_TERRITORY)
            }
          }
          for (var dpoint of data.territory.dame_points) {
            node.setMark( rc2Jgo( dpoint[0], dpoint[1]), JGO.MARK.TRIANGLE)
          }
          /* black_points = data.result[0]
           * white_points = data.result[1]*/
          var diff = Math.abs( black_points - white_points)
          var rstr = `W+${diff} (before komi and handicap)`
          if (black_points >= white_points) { rstr = `B+${diff}  (before komi and handicap)` }
          $('#status').html( `Black:${black_points} &emsp; White:${white_points} &emsp; ${rstr}`)
        }) // (surepoints) =>
      } // (data)
    ) // hit_endpoint()
  } // scorePosition()
  scorePosition.active = false

  //------------------------
  function isGameOver() {
    var len = g_record.length
    if (len > 1) {
      if (g_record[ len - 1] == 'pass' && g_record[ len - 2] == 'pass') {
        return true
      }
    }
    return false
  } // isGameOver()

  // Play a game. Start another when over, or alert
  //-------------------------------------------------
  function autoPlay() {
    console.log( 'autoplay')
    $('#status').html( 'playing...')
    g_timer = setInterval(
      function() {
        if (isGameOver()) {
          clearInterval( g_timer)
          $('#status').html( 'Game Over')
          //newGame()
          //autoPlay()
        }
        else {
          getBotMove()
        }
      },
      AUTOPLAY_MOVE_DUR_MS)
    return false
  } // autoPlay()

  //---------------------
  function newGame() {
    console.log( 'new game')
    $('#status').html( '&nbsp;')
    clearInterval( g_timer)
    resetGame()
    return false
  } // newGame()

  // Init new game and replay the moves
  //------------------------------------
  function replayMoveList( mlist) {
    resetGame()
    for (var move_string of mlist) {
      if (move_string == 'pass' || move_string == 'resign') {
        g_ko = false
        addMove( move_string)
      }
      else {
        var coord = stringToCoords( move_string)
        applyMove( g_player, coord)
      }
      g_player =  (g_player == JGO.BLACK) ? JGO.WHITE : JGO.BLACK
    } // for
  } // replayMoveList()

  // Replay and show game up to move n
  //-------------------------------------
  function gotoMove( n) {
    var totmoves = g_complete_record.length
    if (n > totmoves) { n = totmoves }
    if (n < 1) { resetGame(); return }
    var record = g_complete_record.slice( 0, n)
    replayMoveList( record)
    $('#status').html( `${n} / ${totmoves}`)
    //g_record_pos = n
  } // gotoMove()

  // Set the big button to next or prev
  //-------------------------------------
  function set_again( id) {
    g_cur_btn = '#btn_next'
    $('#btn_again').html('Next')

    if (id == '#btn_prev') {
      g_cur_btn = '#btn_prev'
      $('#btn_again').html('Prev')
    }
  } // set_again()

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

  //--------------------------------
  function botmove_if_active() {
    if (g_waiting_for_bot) { return }
    if (activate_bot.botname == 'leela') {
      $('#status').html( 'Leela is thinking...')
      getBotMove( false, 0.0)
    }
    else if (activate_bot.botname == 'kroker') {
      $('#status').html( 'Kroker is thinking...')
      getBotMove( false, KROKER_RANDOMNESS)
    }
  } // botmove_if_active()

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
      $('#btn_accept_var').removeClass('disabled')
      $('#btn_clear_var').css('color', 'green');
      $('#btn_accept_var').css('color', 'red');
    }
    else {
      $('#btn_clear_var').addClass('disabled')
      $('#btn_accept_var').addClass('disabled')
      $('#btn_clear_var').css('color', 'gray');
      $('#btn_accept_var').css('color', 'gray');
    }
  } // var_button_state()

  // Set button callbacks
  //------------------------------
  function set_btn_handlers() {
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
      $('#histo').hide()
      activate_bot( 'leela')
      set_again( '#btn_prev')
      $('#status').html( 'Leela is thinking...')
      getBotMove( false, 0.0)
      return false
    })

    $('#btn_kroker').click( () => {
      $('#histo').hide()
      activate_bot( 'kroker')
      set_again( '#btn_prev')
      $('#status').html( 'Kroker is thinking...')
      getBotMove( false, KROKER_RANDOMNESS)
      return false
    })

    $('#btn_prob').click( () => {
      $('#histo').hide()
      $('#status').html( 'thinking...')
      var prob_only_flag = true
      getBotMove( prob_only_flag)
      return false
    })

    $('#btn_save').click( () => {
      var rec = g_complete_record.slice()
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
      scorePosition( 'nnscore')
      $('#histo').show()
      return false
    })

    $('#btn_pass').click( () => {
      g_complete_record = g_record.slice()
      g_complete_record.push( 'pass')
      gotoMove( g_complete_record.length)
      botmove_if_active()
    })

    $('#btn_undo').click( () => { $('#histo').hide(); gotoMove( g_record.length - 1); g_complete_record = g_record; activate_bot('') })
    $('#btn_prev').click( () => { $('#histo').hide(); gotoMove( g_record.length - 1); set_again( '#btn_prev'); activate_bot('') })
    $('#btn_next').click( () => { $('#histo').hide(); gotoMove( g_record.length + 1); set_again( '#btn_next'); activate_bot('') })
    $('#btn_back10').click( () => { $('#histo').hide(); set_again(''); gotoMove( g_record.length - 10); activate_bot('') })
    $('#btn_fwd10').click( () => { $('#histo').hide(); set_again(''); gotoMove( g_record.length + 10); activate_bot('') })
    $('#btn_first').click( () => { $('#histo').hide(); set_again( '#btn_next'); resetGame(); activate_bot(''); $('#status').html( '&nbsp;') })
    $('#btn_last').click( () => { $('#histo').hide(); set_again( '#btn_prev'); gotoMove( g_complete_record.length); activate_bot('') })
    $('#btn_again').click( () => { if (g_cur_btn) { $('#histo').hide(); $(g_cur_btn).click(); activate_bot('') } })
  } // set_btn_handlers()

  // Arrow key actions
  //------------------------
  function checkKey(e) {
    e = e || window.event;
    if (e.keyCode == '38') { // up arrow
    }
    else if (e.keyCode == '40') { // down arrow
    }
    else if (e.keyCode == '37') { // left arrow
      activate_bot('')
      gotoMove( g_record.length - 1)
    }
    else if (e.keyCode == '39') { // right arrow
      activate_bot('')
      gotoMove( g_record.length + 1)
    }
  } // checkKey()

  // Plot histogram of territory probabilities
  //---------------------------------------------
  function plot_histo( data, completion) {
    var wp = data.white_probs
    axutil.hit_endpoint( '/histo', [wp,20,0,1], (res) => {
      var surepoints = res[0][1] + res[res.length-1][1]
      axutil.barchart( '#histo', res, 240)
      completion( surepoints)
    })
  } // plot_histo()

} // function main()
