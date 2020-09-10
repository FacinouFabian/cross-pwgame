import express from 'express'
import dotenv from 'dotenv'
import chalk from 'chalk'
import io, { Socket } from 'socket.io'
import {EventEmitter} from "events"
import moment from 'moment'

import { isNull, display } from './utils'

interface User {
  nickname?: string
}

interface Room { 
  roomId: number 
}

interface UserAnswer {
  magicNumber: number
  roomId: number,
  nickname: string
}

type partystate = "waiting" | "started" | "paused" | "finished"

type PlayerState = "ready" | "not ready" | "In game"

type Player = {
  name: string,
  state: PlayerState;
  points: number
}

type Players = Player[]

type Party = {
  id: number | null,
  beg: string,
  end: string,
  players: Players,
  state: partystate,
  haveBeenStarted: boolean,
  isEnded: boolean,
  magicNumber?: number | null,
  round: number,
  type: string
}

type Game = {
  id: number,
  name: string,
  description: string,
  likes: number
}

interface GamesObject {
  MagicNumber: any[],
  QuickWord: Game[],
  WordAndFurious: Game[]
}

const gamesObject: GamesObject = {
  MagicNumber: [],
  QuickWord: [],
  WordAndFurious: []
}

// prelude -- loading environment variable
dotenv.config()
if (isNull(process.env.PORT)) {
  throw 'Sorry missing PORT env'
}

const port = parseInt(process.env.PORT)
const app = express()

const server = app.listen(port, () => {
  display(chalk.magenta(`crossPWAGame server is running on 0.0.0.0:${port}`))
})

const socketio = io(server)
const ee = new EventEmitter()

const users: Record<string, User> = {}
const games: Game[] = [
  {
    id: 0,
    name: 'MagicNumber',
    description: 'MagicNumber Game',
    likes: 72
  },
  {
    id: 1,
    name: 'QuickWord',
    description: 'QuickWord Game',
    likes: 100
  },
  {
    id: 3,
    name: 'WordAndFurious',
    description: 'WordAndFurious Game',
    likes: 56
  }
]
let room: number = 0

/**
 * @description Display a message when a connection has been initialised
 * @return {void}
*/
socketio.on('connection', (socket: Socket) => {
  // CURRENT SOCKET/PLAYER

  display(chalk.cyan(`Connection opened for ( ${socket.id} )`))

  /* ################################# EXTERNAL EVENTS ################################# */

  /**
   * @description Display a goodbye message when connection closes
   * @return {void}
  */
  socket.on('disconnect', () => {
    if (users[socket.id]?.nickname) {
      const { nickname }: User = users[socket.id]
      display(chalk.yellow(`Goodbye ${nickname}`))
    }
    display(chalk.cyan(`Connection closed for ( ${socket.id} )`))
  })

  /**
   * @description Set a new user to the Users Array
   * @return {void}
  */
  socket.on('game::sendNickname', payload => {
    const user = JSON.parse(payload)
    const { nickname }: User = user
    display(chalk.yellow(`Here comes a new challenger : ${nickname} ( from ${socket.id} )`))

    users[socket.id] = { nickname }
  })

  /**
   * @description Create a new game for a user (the user will be the owner of the game) (in Register.tsx handleCreateParty)
   * @return {void}
  */
  socket.on('game::createParty', payload => {
    const data = JSON.parse(payload)
    const { nickname, gameType }: any = data

    display(chalk.green(`Challenger : ${nickname} ( from ${socket.id} ) created a party!`))

    // create a new game with the user (the update)
    gamesObject[gameType][room] = {
      id: room, 
      beg: "", 
      end: "", 
      players: [
        {
          name: nickname, 
          points: 0, 
          state: "not ready"
        }
      ],
      state: "waiting", magicNumber: null,
      haveBeenStarted: false,
      isEnded: false,
      round: 0,
      type: gameType
    }
    // increment the index for the next created game
    room = room + 1
  })

  /**
   * @description Make a user join a game (in Register.tsx handleJoinParty)
   * @return {void}
  */
  socket.on('game::joinParty', payload => {
    const data = JSON.parse(payload)
    const { nickname, roomId, gameType }: { nickname: string, roomId: number, gameType: any } = data

    display(chalk.green(`Challenger : ${nickname} ( from ${socket.id} ) joined ${gamesObject[gameType][roomId].players[0].name}'s party!`))
    display(chalk.red(`${gamesObject[gameType][roomId].players[0].name}'s party will start!`))

    // add the second user to the game
    gamesObject[gameType][roomId].players.push(
      {
        name: nickname, 
        points: 0, 
        state: "not ready"
      }
    )
    ee.emit('game::start', { roomId, gameType }) 
  })

  /**
   * @description Send all partys (for Rooms.tsx)
   * @return {void}
  */
  socket.on('game::getRooms', () => {
    const partys = gamesObject.MagicNumber.concat(gamesObject.QuickWord).concat(gamesObject.WordAndFurious)
    socket.emit('game::rooms', {
      partys
    })
  })

  /**
   * @description Send all games to the hub
   * @return {void}
  */
  socket.on('hub::getGames', () => {
    socket.emit('hub::sendGames', {
      games,
    })
  })

  /**
   * @description Returns a user's game (for Game.tsx)
   * @return {void}
  */
  socket.on('game::getUserParty', payload => {
    const data = JSON.parse(payload)
    const { nickname, gameType }: any = data

    let userGame = gamesObject[gameType].find(game => game.players.find(player => player.name === nickname))

    // The player is found in a game
    userGame != undefined ? 
    // send the game
    socket.emit('game::userParty', { party: userGame })
    // the player was not found
    : display(chalk.cyan(`Cannot find player ${nickname} in a game.`))
  })

  /**
   * @description Change a user's state (is he ready to play or not ?)
   * @return {void}
  */
  socket.on('game::playerState', payload => {
    const data = JSON.parse(payload)
    const { roomId, nickname, state }: { roomId: number, nickname: string, state: PlayerState } = data
    const game: Party = gamesObject['MagicNumber'][roomId]

    // search player
    for (const player of game.players) {
      // if player found
      if (player.name === nickname) {
        // change player's state 
        player.state = state
        display(chalk.blue(`Player ${player.name} is ${player.state}.`))
      }
    }

    // if the game have 2 players
    if (game.players.length === 2) {
      // if the 2 players are ready to play
      game.players[0].state === "ready" && game.players[1].state === "ready" ? 
      //start the game
      ee.emit('game::start', { roomId }) 
      // else
      : display(chalk.yellowBright('Waiting for the 2nd player before starting.'))
    }
  })

  /**
   * @description Pause a game
   * @return {void}
  */
  socket.on("game::pause", payload => {
    const { roomId, nickname }: { roomId: number, nickname: string } = payload
    const game: Party = gamesObject['MagicNumber'][roomId]

    if (game.state != "paused") {
      game.state = "paused"
      display(chalk.greenBright(`${game.players[0].name}'s party has been paused by ${nickname}.`))
    }
    else {
      display(chalk.redBright(`${game.players[0].name}'s party is already in pause.`))
    }
  })

  /**
   * @description Starts a game
   * @return {void}
  */
  socket.on("game::userMagicNumber", payload => {
    const { roomId, magicNumber, nickname }: UserAnswer = payload
    const game: Party = gamesObject['MagicNumber'][roomId]
    // search for the player
    let player = game.players.find(player => player.name === nickname)

    display(chalk.redBright.underline(`Received magic number ${magicNumber} from ${nickname}.`))

    // if the current round is less than 3
    if (game.round < 3) {
      // if the magic number is the same as the user response
      if (game.magicNumber === magicNumber) {
        if (player != undefined) {
          // increment player's points
          player.points = player.points + 1

          // tell the player he founded the magic number
          socket.emit('game::isMagicNumber', {
            roomId, 
            found: true,
            player: player?.name,
          })

          // send a new magic number
          sendNewMagicNumber(roomId, socket)

          // start next round
          game.round = game.round + 1
          changeRound(roomId, socket)
        }  
      }
      else {
        // tell the player he doesn't found the magic number
        socket.emit('game::isMagicNumber', { 
          found: false,
        }) 
      }
    }
    // if the current round is 3
    else {
      // magic number founded
      if (game.magicNumber === magicNumber){
        // player founded
        if (player != undefined){
          // increment player's points and finish the game
          player.points = player.points + 1
          ee.emit('game::finish', { roomId, gameType: 'MagicNumber' }) 
        }
      }
    }
  })

  /* ################################# INTERNS EVENTS ################################# */

  /**
   * @description Start a game
   * @return {void}
  */
  ee.on("game::start", payload => {
    const { roomId }: Room = payload
    const { gameType }: any = payload
    const game: Party = gamesObject[gameType][roomId]

    game.round = 1

    if (game.haveBeenStarted === false) {
      // if the game have 2 players
      if (game.players.length === 2) {
        game.state = "started"
        game.haveBeenStarted = true
        game.beg = moment().format() 

        game.players[0].state = "In game"
        game.players[1].state = "In game"

        display(chalk.greenBright(`${game.players[0].name}'s party has started.`))

        // start the game
        startGame(roomId, socket, gameType)
      }
      else {
        display(chalk.redBright(`Cannot start ${game.players[0].name}'s party. Error: Missing player(s)`))
      }
    }
  })

  /**
   * @description Finish a game and display ranking
   * @return {void}
  */
  ee.on("game::finish", payload => {
    const { roomId }: Room = payload
    const { gameType }: any = payload
    const game: Party = gamesObject[gameType][roomId]
    
    if (game.isEnded === false) {
      game.isEnded = true

      // sort players by points
      const ranking = game.players.sort((player1: Player, player2: Player) => {
        return player2.points - player1.points
      })

      const winner: Player = ranking[0]

      game.state = "finished"
      game.players.map( player => {
        player.state = "not ready"
      })
      game.end = moment().format()
      
      // display game results
      display(chalk.greenBright(`${game.players[0].name}'s party has finished.`))
      display(chalk.white(`${winner.name} won with ${winner.points} points !`))

      endGame(roomId, socket, ranking, gameType)
    }
  })

})

/* ################################# FUNCTIONS ################################# */

const startGame = (roomId: number, socket: Socket, type: any): void => {
  const game: Party = gamesObject[type][roomId]
  if (type === 'MagicNumber'){
    sendNewMagicNumber(roomId, socket)
  }
  socket.emit('game::partystart', { roomId, gameType: type }) 
}

const sendNewMagicNumber = (roomId: number, socket: Socket): void => {
  const magicNumber: number =  Math.floor(Math.random() * Math.floor(5))
  const game: Party = gamesObject['MagicNumber'][roomId]
  game.magicNumber = magicNumber
  display(chalk.magenta(`${magicNumber} is the magic number.`))
  socket.emit('game::magicNumber', { roomId, magicNumber })
}

const changeRound = (roomId: number, socket: Socket): void => {
  socket.emit('game::nextStep', { roomId }) 
}

const endGame = (roomId: number, socket: Socket, ranking: any, type: any): void => {
  socket.emit('game::gameFinish', { roomId, ranking, gameType: type })
}