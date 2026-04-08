const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Store rooms and their states
const rooms = {};

const winds = ['东', '南', '西', '北'];
const allTilesTemplate = [
    '一万','二万','三万','四万','五万','六万','七万','八万','九万', 
    '一筒','二筒','三筒','四筒','五筒','六筒','七筒','八筒','九筒', 
    '一索','二索','三索','四索','五索','六索','七索','八索','九索',
    '东','南','西','北'
];

function shuffleDeck() {
    let deck = [];
    for (let i = 0; i < 4; i++) {
        deck = deck.concat(allTilesTemplate);
    }
    return deck.sort(() => Math.random() - 0.5);
}

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('createRoom', (data, callback) => {
        const roomId = Math.floor(100000 + Math.random() * 900000).toString();
        rooms[roomId] = {
            id: roomId,
            password: data.password,
            players: {}, // socketId -> { seat, ready, hand, isTing }
            seats: { '东': null, '南': null, '西': null, '北': null },
            state: 'waiting', // waiting, playing
            deck: [],
            discardPile: [],
            currentTurn: null, // seat name
        };
        socket.join(roomId);
        callback({ success: true, roomId });
        console.log(`Room ${roomId} created by ${socket.id}`);
    });

    socket.on('joinRoom', (data, callback) => {
        const room = rooms[data.roomId];
        if (!room) {
            return callback({ success: false, message: '房间不存在' });
        }
        if (room.password && room.password !== data.password) {
            return callback({ success: false, message: '密码错误' });
        }
        socket.join(data.roomId);
        callback({ success: true, roomInfo: getRoomInfo(room) });
        io.to(data.roomId).emit('roomUpdated', getRoomInfo(room));
    });

    socket.on('selectSeat', (data, callback) => {
        const room = rooms[data.roomId];
        if (!room) return;

        if (room.seats[data.seat] && room.seats[data.seat] !== socket.id) {
            return callback({ success: false, message: '该座位已被占用' });
        }

        // Remove from previous seat if any
        for (let s in room.seats) {
            if (room.seats[s] === socket.id) {
                room.seats[s] = null;
            }
        }

        room.seats[data.seat] = socket.id;
        if (!room.players[socket.id]) {
            room.players[socket.id] = { ready: false, hand: [], isTing: false };
        }
        room.players[socket.id].seat = data.seat;

        callback({ success: true });
        io.to(data.roomId).emit('roomUpdated', getRoomInfo(room));
    });

    socket.on('ready', (data) => {
        const room = rooms[data.roomId];
        if (!room || !room.players[socket.id]) return;

        room.players[socket.id].ready = true;
        io.to(data.roomId).emit('roomUpdated', getRoomInfo(room));

        // Check if all players in seats are ready and at least 3 players are seated
        let allReady = true;
        let playerCount = 0;
        for (let s in room.seats) {
            if (room.seats[s]) {
                playerCount++;
                if (!room.players[room.seats[s]].ready) {
                    allReady = false;
                }
            }
        }

        if (playerCount >= 3 && allReady) {
            startGame(room);
        } else if (allReady && playerCount > 0) {
            // Notify players that more people are needed
            io.to(room.id).emit('waitingForPlayers', { 
                current: playerCount, 
                required: 3,
                message: `当前房间只有 ${playerCount} 人准备，至少需要 3 人才能开始游戏。`
            });
        }
    });

    socket.on('drawTile', (data) => {
        const room = rooms[data.roomId];
        if (!room || room.state !== 'playing') return;

        const player = room.players[socket.id];
        if (!player || room.currentTurn !== player.seat) return;
        if (player.hand.length >= 14) return; // Already has 14 tiles

        if (room.deck.length === 0) {
            io.to(room.id).emit('gameOver', { message: '流局！牌库已空。' });
            room.state = 'waiting';
            return;
        }

        const tile = room.deck.pop();
        player.hand.push(tile);
        
        socket.emit('handUpdated', { hand: player.hand });
        io.to(room.id).emit('gameStateUpdated', getGameState(room));
    });

    socket.on('discardTile', (data) => {
        const room = rooms[data.roomId];
        if (!room || room.state !== 'playing') return;

        const player = room.players[socket.id];
        if (!player || room.currentTurn !== player.seat) return;
        if (player.hand.length !== 14) return;

        const { index, isTingAction } = data;
        const tile = player.hand[index];

        if (isTingAction) {
            if (!winds.includes(tile)) {
                return socket.emit('errorMsg', '报听时必须打出风牌！');
            }
            player.isTing = true;
            io.to(room.id).emit('playerTing', { seat: player.seat });
        } else if (player.isTing) {
            // If already ting, can only discard the last drawn tile (index 13)
            if (index !== player.hand.length - 1) {
                return socket.emit('errorMsg', '听牌后不能换牌，只能打出刚摸到的牌！');
            }
        }

        // Remove tile from hand and add to discard pile
        player.hand.splice(index, 1);
        room.discardPile.push(tile);

        // Next turn (simplified: just pass to next occupied seat)
        room.currentTurn = getNextTurn(room, player.seat);

        socket.emit('handUpdated', { hand: player.hand, isTing: player.isTing });
        io.to(room.id).emit('gameStateUpdated', getGameState(room));
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Handle player disconnection (cleanup rooms)
        for (let roomId in rooms) {
            const room = rooms[roomId];
            if (room.players[socket.id]) {
                const seat = room.players[socket.id].seat;
                if (seat) room.seats[seat] = null;
                delete room.players[socket.id];
                io.to(roomId).emit('roomUpdated', getRoomInfo(room));
                
                // If game was playing, maybe end it
                if (room.state === 'playing') {
                     io.to(roomId).emit('gameOver', { message: `玩家 ${seat}风 掉线，游戏结束。` });
                     room.state = 'waiting';
                }
            }
        }
    });
});

function startGame(room) {
    room.state = 'playing';
    room.deck = shuffleDeck();
    room.discardPile = [];
    room.currentTurn = '东'; // East always starts (simplified)

    // Deal tiles
    for (let socketId in room.players) {
        const player = room.players[socketId];
        player.hand = [];
        player.isTing = false;
        player.ready = false; // Reset ready state for next game
        
        const tilesToDeal = player.seat === room.currentTurn ? 14 : 13;
        for (let i = 0; i < tilesToDeal; i++) {
            player.hand.push(room.deck.pop());
        }
        
        // Sort hand
        sortHand(player.hand);
        
        io.to(socketId).emit('gameStarted', {
            hand: player.hand,
            isTing: player.isTing
        });
    }

    io.to(room.id).emit('gameStateUpdated', getGameState(room));
}

function getNextTurn(room, currentSeat) {
    const seatOrder = ['东', '南', '西', '北'];
    let currentIndex = seatOrder.indexOf(currentSeat);
    for (let i = 1; i <= 4; i++) {
        let nextIndex = (currentIndex + i) % 4;
        let nextSeat = seatOrder[nextIndex];
        if (room.seats[nextSeat]) {
            return nextSeat;
        }
    }
    return currentSeat;
}

function sortHand(hand) {
    hand.sort((a, b) => {
        const typeA = winds.includes(a) ? 3 : a.includes('索') ? 2 : a.includes('筒') ? 1 : 0;
        const typeB = winds.includes(b) ? 3 : b.includes('索') ? 2 : b.includes('筒') ? 1 : 0;
        if(typeA !== typeB) return typeA - typeB;
        return a.localeCompare(b);
    });
}

function getRoomInfo(room) {
    const playersInfo = {};
    for(let s in room.seats) {
        if(room.seats[s]) {
             playersInfo[s] = {
                 ready: room.players[room.seats[s]].ready
             };
        } else {
             playersInfo[s] = null;
        }
    }
    return {
        id: room.id,
        state: room.state,
        seats: playersInfo
    };
}

function getGameState(room) {
    return {
        deckCount: room.deck.length,
        discardPile: room.discardPile,
        currentTurn: room.currentTurn
    };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});