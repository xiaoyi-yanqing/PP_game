const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// 允许跨域，支持 file:// 协议直接打开本地 HTML 时连接
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Store rooms and their states
const rooms = {};

const winds = ['东', '南', '西', '北', '红中', '发财', '白板'];
const allTilesTemplate = [
    '一万','二万','三万','四万','五万','六万','七万','八万','九万', 
    '一筒','二筒','三筒','四筒','五筒','六筒','七筒','八筒','九筒', 
    '一索','二索','三索','四索','五索','六索','七索','八索','九索',
    '东','南','西','北', '红中', '发财', '白板'
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
        // 生成3位随机数字的房间号 (100-999)
        const roomId = Math.floor(100 + Math.random() * 900).toString();
        rooms[roomId] = {
            id: roomId,
            password: data.password,
            players: {}, // socketId -> { seat, ready, hand, isTing, outTiles: [], discards: [] } // outTiles 记录碰杠的牌, discards 记录该玩家打出的牌
            seats: { '东': null, '南': null, '西': null, '北': null },
            state: 'waiting', // waiting, playing
            deck: [],
            discardPile: [], // 全局记录用于回退(如果碰/杠的话)
            currentTurn: null, // seat name
            lastDiscard: null, // { tile: '东', seat: '南' }
            pendingActions: [], // 存储其他玩家可执行的操作 [{seat, type: 'peng'|'gang'|'hu', tile}]
            actionTimeout: null // 定时器
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
            room.players[socket.id] = { ready: false, hand: [], isTing: false, outTiles: [], discards: [] };
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

        if (allReady && playerCount > 0 && playerCount < 2) {
            io.to(room.id).emit('waitingForPlayers', { 
                current: playerCount, 
                required: 2,
                message: `当前房间只有 ${playerCount} 人，至少需要 2 人才能开始游戏。`
            });
        }
    });

    socket.on('requestStartGame', (data) => {
        const room = rooms[data.roomId];
        if (!room || room.state === 'playing') return;
        
        const player = room.players[socket.id];
        if (!player || player.seat !== '东') {
            return socket.emit('errorMsg', '只有东风玩家可以开始游戏！');
        }

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

        if (playerCount >= 2 && allReady) {
            startGame(room);
        } else {
            socket.emit('errorMsg', '需要至少2人且所有人都准备好才能开始！');
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
            
            // 【前置校验】判断打出这张牌后，剩下的 13 张牌是否处于“听牌”状态
            // 听牌的定义是：剩下 13 张牌，再加上任意一张所有麻将牌中的牌，能满足胡牌条件
            let remainingHand = [...player.hand];
            remainingHand.splice(index, 1);
            let canTing = false;
            for (let testTile of allTilesTemplate) {
                let testHand = [...remainingHand, testTile];
                if (checkHu(testHand)) {
                    canTing = true;
                    break;
                }
            }
            
            if (!canTing) {
                return socket.emit('errorMsg', '当前牌型不符合听牌条件！请凑齐 m*ABC + n*AAA + 一对将牌。');
            }

            player.isTing = true;
            io.to(room.id).emit('playerTing', { seat: player.seat });
        } else if (player.isTing) {
            // 听牌后，不能换牌，只能打出最后摸到的那张牌 (即索引最大的牌)
            // 如果玩家手里有 14 张牌，最后一张就是 index = 13 (手牌数组的最后一个)
            if (index !== player.hand.length - 1) {
                return socket.emit('errorMsg', '听牌后不能换牌，只能打出刚摸到的牌！(但可以杠)');
            }
        }

        // Remove tile from hand and add to discard pile
        player.hand.splice(index, 1);
        room.discardPile.push({tile, seat: player.seat}); // 改为对象存储，包含来源座位
        player.discards.push(tile); // 记录在该玩家的独立出牌堆里
        room.lastDiscard = { tile, seat: player.seat };

        // 发送更新让大家看到出的牌
        socket.emit('handUpdated', { hand: player.hand, isTing: player.isTing, outTiles: player.outTiles });
        io.to(room.id).emit('gameStateUpdated', getGameState(room));

        // 检查其他玩家是否有碰、杠、胡的操作
        room.pendingActions = checkOtherPlayersActions(room, tile, player.seat);
        
        if (room.pendingActions.length > 0) {
            // 通知有操作的玩家
            room.pendingActions.forEach(action => {
                const targetSocketId = room.seats[action.seat];
                io.to(targetSocketId).emit('availableActions', room.pendingActions.filter(a => a.seat === action.seat));
            });
            // 等待操作，暂不流转回合
        } else {
            // Next turn (simplified: just pass to next occupied seat)
            moveToNextTurn(room, player.seat);
        }
    });

    socket.on('playerAction', (data) => {
        const room = rooms[data.roomId];
        if (!room || room.state !== 'playing') return;

        const player = room.players[socket.id];
        if (!player) return;

        const { actionType, tile } = data; // 'peng', 'gang', 'hu', 'pass', 'angang', 'jiagang'

        if (actionType === 'pass') {
            // 过滤掉当前玩家的等待动作
            room.pendingActions = room.pendingActions.filter(a => a.seat !== player.seat);
            socket.emit('availableActions', []);
            
            if (room.pendingActions.length === 0) {
                // 所有人都过牌了，回合继续流转
                moveToNextTurn(room, room.lastDiscard.seat);
            }
            return;
        }

        // 处理胡牌 (最高优先级，简化为只要点胡就算赢)
        if (actionType === 'hu') {
            io.to(room.id).emit('gameOver', { message: `玩家 ${player.seat}风 胡牌啦！胡的是【${tile}】` });
            room.state = 'waiting';
            return;
        }

        // 处理碰牌
        if (actionType === 'peng') {
            room.pendingActions = []; // 清空其他等待动作
            io.to(room.id).emit('availableActions', []); // 广播取消所有按钮

            // 从弃牌堆移除该牌
            const lastDisc = room.discardPile.pop();
            // 同时从来源玩家的独立出牌堆里移除
            if (lastDisc) {
                const srcPlayerSocket = room.seats[lastDisc.seat];
                if (srcPlayerSocket && room.players[srcPlayerSocket]) {
                    room.players[srcPlayerSocket].discards.pop();
                }
            }

            // 从手牌扣除2张，加入 outTiles
            let removed = 0;
            for(let i = player.hand.length - 1; i >= 0; i--) {
                if(player.hand[i] === tile) {
                    player.hand.splice(i, 1);
                    removed++;
                    if(removed === 2) break;
                }
            }
            player.outTiles.push({ type: 'peng', tile });
            
            // 切换回合到碰牌的玩家，并且此时他有14张牌(碰了之后要打一张)，但因为是碰，所以手牌应该是14-3+0 = 11? 
            // 碰牌后，玩家不需要摸牌，直接出牌，所以此时手牌数量应为 13-2 = 11 + 1(碰的牌不算手牌) = 实际还要打一张
            // 简单处理：把回合切给他，前端判断如果不是14张而是14的倍数+1? 正常13张手牌碰了剩11张，还需要打1张，所以他可以随时打牌。
            // 为了保持我们之前的逻辑（14张才能打），我们虚拟给他“摸”一张空牌或者不需要摸牌直接让打
            // 修改前端逻辑：只要轮到你且 hand.length % 3 === 2 就能打牌
            room.currentTurn = player.seat;

            socket.emit('handUpdated', { hand: player.hand, isTing: player.isTing, outTiles: player.outTiles });
            io.to(room.id).emit('gameStateUpdated', getGameState(room));
            io.to(room.id).emit('roomMessage', `玩家 ${player.seat}风 碰了【${tile}】！`);
            return;
        }

        // 处理明杠
        if (actionType === 'gang') {
            room.pendingActions = [];
            io.to(room.id).emit('availableActions', []);

            const lastDisc = room.discardPile.pop();
            if (lastDisc) {
                const srcPlayerSocket = room.seats[lastDisc.seat];
                if (srcPlayerSocket && room.players[srcPlayerSocket]) {
                    room.players[srcPlayerSocket].discards.pop();
                }
            }

            let removed = 0;
            for(let i = player.hand.length - 1; i >= 0; i--) {
                if(player.hand[i] === tile) {
                    player.hand.splice(i, 1);
                    removed++;
                    if(removed === 3) break;
                }
            }
            player.outTiles.push({ type: 'gang', tile });
            room.currentTurn = player.seat;
            
            socket.emit('handUpdated', { hand: player.hand, isTing: player.isTing, outTiles: player.outTiles });
            io.to(room.id).emit('roomMessage', `玩家 ${player.seat}风 杠了【${tile}】！`);
            
            // 杠完要自动摸一张岭上牌
            drawTileForPlayer(room, socket.id);
            return;
        }

        // 处理暗杠、加杠 (这是玩家在自己回合主动发起的)
        if (actionType === 'angang' || actionType === 'jiagang') {
            if (room.currentTurn !== player.seat) return;

            if (actionType === 'angang') {
                let removed = 0;
                for(let i = player.hand.length - 1; i >= 0; i--) {
                    if(player.hand[i] === tile) {
                        player.hand.splice(i, 1);
                        removed++;
                        if(removed === 4) break;
                    }
                }
                player.outTiles.push({ type: 'angang', tile });
            } else { // 加杠
                // 把碰变成杠
                const target = player.outTiles.find(o => o.type === 'peng' && o.tile === tile);
                if (target) target.type = 'gang';
                
                // 从手牌删掉1张
                const idx = player.hand.indexOf(tile);
                if (idx > -1) player.hand.splice(idx, 1);
            }

            socket.emit('handUpdated', { hand: player.hand, isTing: player.isTing, outTiles: player.outTiles });
            io.to(room.id).emit('roomMessage', `玩家 ${player.seat}风 ${actionType === 'angang' ? '暗杠' : '加杠'}了【${tile}】！`);
            
            // 自动摸岭上牌
            drawTileForPlayer(room, socket.id);
            return;
        }

    });

    socket.on('restartGame', (data) => {
        const room = rooms[data.roomId];
        if (!room || room.state !== 'playing') return;
        
        const player = room.players[socket.id];
        if (!player || player.seat !== '东') {
            return socket.emit('errorMsg', '只有东风玩家可以重新开始游戏！');
        }

        io.to(room.id).emit('roomMessage', '东风玩家发起了【再来一局】，正在重新洗牌发牌...');
        
        // 直接重新开始游戏
        setTimeout(() => {
            startGame(room);
        }, 1000);
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
    room.pendingActions = [];

    // Deal tiles
    for (let socketId in room.players) {
        const player = room.players[socketId];
        player.hand = [];
        player.outTiles = [];
        player.discards = []; // 重置玩家出牌记录
        player.isTing = false;
        player.ready = false; // Reset ready state for next game
        
        // 发牌统一13张，由东风先摸牌
        for (let i = 0; i < 13; i++) {
            player.hand.push(room.deck.pop());
        }
        
        // Sort hand
        sortHand(player.hand);
        
        io.to(socketId).emit('gameStarted', {
            hand: player.hand,
            isTing: player.isTing,
            outTiles: player.outTiles
        });
    }

    io.to(room.id).emit('gameStateUpdated', getGameState(room));
    
    // 给东风发第一张牌
    const eastSocketId = room.seats['东'];
    if (eastSocketId) {
        setTimeout(() => {
            drawTileForPlayer(room, eastSocketId);
        }, 1000);
    }
}

function moveToNextTurn(room, currentSeat) {
    room.currentTurn = getNextTurn(room, currentSeat);
    io.to(room.id).emit('gameStateUpdated', getGameState(room));
    
    // 自动为下个玩家摸牌
    const nextSocketId = room.seats[room.currentTurn];
    if (nextSocketId) {
        setTimeout(() => {
            drawTileForPlayer(room, nextSocketId);
        }, 800);
    }
}

function drawTileForPlayer(room, socketId) {
    if (room.state !== 'playing') return;
    const player = room.players[socketId];
    if (!player) return;

    if (room.deck.length === 0) {
        io.to(room.id).emit('gameOver', { message: '流局！牌库已空。' });
        room.state = 'waiting';
        return;
    }

    const tile = room.deck.pop();
    player.hand.push(tile);
    
    // 检查自己摸牌后是否可以暗杠或加杠或自摸胡
    let myActions = [];
    const tileCounts = getTileCounts(player.hand);
    
    // 检查暗杠
    for (let t in tileCounts) {
        if (tileCounts[t] === 4) {
            myActions.push({ seat: player.seat, type: 'angang', tile: t });
        }
    }
    // 检查加杠 (手牌里有1张，且outTiles里有对应的peng)
    player.outTiles.forEach(out => {
        if (out.type === 'peng' && player.hand.includes(out.tile)) {
            myActions.push({ seat: player.seat, type: 'jiagang', tile: out.tile });
        }
    });

    // 检查自摸胡牌
    if (player.isTing && checkHu(player.hand)) {
        myActions.push({ seat: player.seat, type: 'hu', tile: tile });
    }

    io.to(socketId).emit('handUpdated', { hand: player.hand, outTiles: player.outTiles, drawAnimation: true });
    io.to(room.id).emit('gameStateUpdated', getGameState(room));

    if (myActions.length > 0) {
        io.to(socketId).emit('availableActions', myActions);
    }
}

function checkOtherPlayersActions(room, discardTile, discardSeat) {
    let actions = [];
    for (let socketId in room.players) {
        const player = room.players[socketId];
        if (player.seat === discardSeat) continue;

        let count = 0;
        player.hand.forEach(t => { if (t === discardTile) count++; });

        // 可以碰
        if (count >= 2) {
            actions.push({ seat: player.seat, type: 'peng', tile: discardTile });
        }
        // 可以明杠
        if (count === 3) {
            actions.push({ seat: player.seat, type: 'gang', tile: discardTile });
        }
        // 简化胡牌检测，只要有听牌状态，就假设可以胡这张（真实麻将需要更复杂的算法，这里演示流程）
        if (player.isTing) {
            // 根据规则：如果房间人数不足 4 人，听牌后只能自摸，不能胡别人打出来的牌 (点炮胡)
            const playerCount = Object.keys(room.players).length;
            if (playerCount === 4) {
                actions.push({ seat: player.seat, type: 'hu', tile: discardTile });
            }
        }
    }
    return actions;
}

function getTileCounts(hand) {
    let counts = {};
    hand.forEach(t => {
        counts[t] = (counts[t] || 0) + 1;
    });
    return counts;
}

// 核心：简易的麻将胡牌算法判断 (判断是否满足 m*ABC + n*AAA + DD)
function checkHu(handTiles) {
    // 拷贝一份，以免修改原手牌
    let tiles = [...handTiles];
    
    // 按花色分类并排序，简化判断
    let typeMap = { '万': [], '筒': [], '索': [], '风': [] };
    tiles.forEach(t => {
        if (t.includes('万')) typeMap['万'].push(parseInt(t.replace('万', '')));
        else if (t.includes('筒')) typeMap['筒'].push(parseInt(t.replace('筒', '')));
        else if (t.includes('索')) typeMap['索'].push(parseInt(t.replace('索', '')));
        else typeMap['风'].push(t);
    });

    for (let key in typeMap) {
        if (key !== '风') {
            typeMap[key].sort((a, b) => a - b);
        }
    }

    // 寻找将牌 (对子)
    let pairFound = false;
    
    // 遍历所有可能的将牌
    for (let key in typeMap) {
        let arr = typeMap[key];
        let uniqueTiles = [...new Set(arr)];
        
        for (let t of uniqueTiles) {
            let count = arr.filter(x => x === t).length;
            if (count >= 2) {
                // 尝试移除这两张牌作为将牌
                let tempMap = JSON.parse(JSON.stringify(typeMap));
                removeTiles(tempMap[key], t, 2);
                
                // 检查剩下的牌是否全都能组成刻子或顺子
                if (checkAllCombos(tempMap)) {
                    return true; // 找到一种可以胡的组合
                }
            }
        }
    }
    return false;
}

function removeTiles(arr, tile, count) {
    for (let i = 0; i < count; i++) {
        let idx = arr.indexOf(tile);
        if (idx !== -1) arr.splice(idx, 1);
    }
}

function checkAllCombos(typeMap) {
    // 检查风牌（只能是刻子，不能是顺子）
    let fengCounts = getTileCounts(typeMap['风']);
    for (let k in fengCounts) {
        if (fengCounts[k] !== 3 && fengCounts[k] !== 0) return false;
    }

    // 检查数牌（万、筒、索），可以是刻子或顺子
    for (let type of ['万', '筒', '索']) {
        let arr = [...typeMap[type]];
        while (arr.length > 0) {
            let first = arr[0];
            let count = arr.filter(x => x === first).length;
            
            // 尝试作为刻子 (AAA)
            if (count >= 3) {
                removeTiles(arr, first, 3);
                continue;
            }
            
            // 尝试作为顺子 (ABC)
            if (arr.includes(first + 1) && arr.includes(first + 2)) {
                removeTiles(arr, first, 1);
                removeTiles(arr, first + 1, 1);
                removeTiles(arr, first + 2, 1);
                continue;
            }
            
            return false; // 既不能凑成刻子也不能凑成顺子
        }
    }
    return true;
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
    // 收集每个玩家的公开信息
    const playersPublicInfo = {};
    for (let socketId in room.players) {
        const player = room.players[socketId];
        playersPublicInfo[player.seat] = {
            seat: player.seat,
            handCount: player.hand.length,
            outTiles: player.outTiles,
            discards: player.discards, // 添加个人的弃牌数组
            isTing: player.isTing
        };
    }

    return {
        deckCount: room.deck.length,
        discardPile: room.discardPile,
        currentTurn: room.currentTurn,
        players: playersPublicInfo
    };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});