
/*
 * Main entry point for web_gui Go board
 * AHN Apr 2019
 */

'use strict'

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
  var g_record_pos = 0
  var g_timer = null
  var g_waiting_for_bot = null
  var g_last_x = -1
  var g_last_y = -1
  var g_last_hover = false
  var g_cur_btn = 'btn_next'

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
            if (g_waiting_for_bot) {
              return
            }
            var jboard = g_jrecord.jboard
            // clear hover away
            if (g_last_hover) { jboard.setType(new JGO.Coordinate( g_last_x, g_last_y), JGO.CLEAR) }
            g_last_hover = false
            var mstr = coordsToString( coord)
            g_complete_record = g_record.slice()
            g_complete_record.push( mstr)
            gotoMove( g_complete_record.length)
            if (hilite_move_btn.v) {
              $('#status').html( 'thinking...')
              getBotMove()
            }
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
        g_record_pos = g_complete_record.length
        var winner = res.winner.toUpperCase()
        var komi = res.komi
        // Game Info
        $('#game_info').html( `B:${res.pb} &nbsp;&nbsp; W:${res.pw} &nbsp;&nbsp; Winner:${winner} &nbsp;&nbsp; Komi:${komi}`)
        $('#fname').html( res.fname)
        set_again( '#btn_prev')
      })
    }) // $('sgf-file')
  } // set_upload_sgf_handler()

  //------------------------
  function resetGame() {
    // Instantiate globals
    g_player = JGO.BLACK // next player
    g_ko = false
    g_lastMove = false
    g_record = []
    g_record_pos = 0
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
    g_record_pos = g_record.length
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
  //-----------------------------------------------
  function getBotMove() {
    //console.log( g_record)
    if (g_waiting_for_bot) {
      console.log( 'still waiting')
      return
    }
    g_waiting_for_bot = true
    axutil.hit_endpoint( '/select-move/' + BOT, {'board_size': BOARD_SIZE, 'moves': g_record},
      (data) => {
        if ($('#status').html().startsWith( 'thinking')) {

          $('#status').html( 'P(B wins): ' + parseFloat(data.diagnostics.winprob).toFixed(2))
        }
        if (data.bot_move == 'pass') {
          addMove( data.bot_move)
          g_ko = false
          alert( 'The bot passes. Click on the Score button.')
        }
        else if (data.bot_move == 'resign') {
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
        g_record_pos = g_complete_record.length
        g_waiting_for_bot = false
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
    fetch( '/' + endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify( {'board_size': BOARD_SIZE, 'moves': g_record}),
    }).then(
      function(response) {
        response.json().then(
          function(data) {
            plot_histo(data)
            var black_points = data.result[0]
            var white_points = data.result[1]
            var diff = Math.abs( black_points - white_points)
            var rstr = `W+${diff} (before komi and handicap)`
            if (black_points >= white_points) { rstr = `B+${diff}  (before komi and handicap)` }
            $('#status').html( `Black:${black_points} &emsp; White:${white_points} &emsp; ${rstr}`)
            var node = g_jrecord.createNode( true)
            for (var bpoint of data.territory.black_points) {
              var coord = rc2Jgo( bpoint[0], bpoint[1])
              if (node.jboard.stones [coord.i] [coord.j] != 1) {
                node.setMark( rc2Jgo( bpoint[0], bpoint[1]), JGO.MARK.BLACK_TERRITORY)
              }
            }
            for (var wpoint of data.territory.white_points) {
              var coord = rc2Jgo( wpoint[0], wpoint[1])
              if (node.jboard.stones [coord.i] [coord.j] != 2) {
                node.setMark( rc2Jgo( wpoint[0], wpoint[1]), JGO.MARK.WHITE_TERRITORY)
              }
            }
            for (var dpoint of data.territory.dame_points) {
              node.setMark( rc2Jgo( dpoint[0], dpoint[1]), JGO.MARK.TRIANGLE)
            }
          }
        )
      }
    ).catch(
      function(error) {
        console.log( error)
      }
    )
  } // scorePosition()

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
    g_record_pos = n
  } // gotoMove()

  // Set the big button to next or prev
  //-------------------------------------
  function set_again( id) {
    g_cur_btn = '#btn_next'
    $('#btn_again').html('NEXT')

    if (id == '#btn_prev') {
      g_cur_btn = '#btn_prev'
      $('#btn_again').html('PREV')
    }
  } // set_again()

  //--------------------------------
  function hilite_move_btn( on) {
    if (on) {
      //$('#btn_move').css('background-color','#EEEEEE')
      hilite_move_btn.v = true
    }
    else {
      $('#btn_move').css('background-color','')
      hilite_move_btn.v = false
    }
  } // hilite_move_btn()
  hilite_move_btn.v = false

  // Set button callbacks
  //------------------------------
  function set_btn_handlers() {
    $('#btn_move').click( () => {
      $('#histo').hide()
      hilite_move_btn(true)
      $('#status').html( 'thinking...')
      getBotMove()
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
      if (hilite_move_btn.v) {
        $('#status').html( 'thinking...')
        getBotMove()
      }
    })

    $('#btn_prev').click( () => { $('#histo').hide(); gotoMove( g_record_pos - 1); set_again( '#btn_prev'); hilite_move_btn(false) })
    $('#btn_next').click( () => { $('#histo').hide(); gotoMove( g_record_pos + 1); set_again( '#btn_next') })
    $('#btn_back10').click( () => { $('#histo').hide(); set_again(''); gotoMove( g_record_pos - 10); hilite_move_btn(false) })
    $('#btn_fwd10').click( () => { $('#histo').hide(); set_again(''); gotoMove( g_record_pos + 10) })
    $('#btn_first').click( () => { $('#histo').hide(); set_again( '#btn_next'); resetGame(); hilite_move_btn(false) })
    $('#btn_last').click( () => { $('#histo').hide(); set_again( '#btn_prev'); gotoMove( g_complete_record.length) })
    $('#btn_again').click( () => { if (g_cur_btn) { $('#histo').hide(); $(g_cur_btn).click() } })
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
      gotoMove( g_record_pos - 1)
    }
    else if (e.keyCode == '39') { // right arrow
      gotoMove( g_record_pos + 1)
    }
  } // checkKey()

  // Plot histogram of territory probabilities
  //---------------------------------------------
  function plot_histo( data) {
    var wp = data.white_probs
    axutil.hit_endpoint( '/histo', [wp,20,0,1], (res) => {
      axutil.barchart( '#histo', res, 240)
    })
  } // plot_histo()

} // function main()
