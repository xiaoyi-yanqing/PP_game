const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx;
let score = 0;

// 默认行列数
let cols = 5;
let rows = 6;
let totalCells = cols * rows; 

// 物品配置：炸弹、金币、钻石比例为 3:2:1
// 注意：这里的 emoji 属性现在只是一个标记，实际显示在格子里的会是动态生成的图标
const items = [
    { type: 'bomb', emoji: '💣', weight: 3, msg: '砰！挖到炸弹啦！' },
    { type: 'coin', emoji: '🪙', weight: 2, msg: '挖到奖励啦！' },
    { type: 'gem', emoji: '💎', weight: 1, msg: '哇！超级大奖！' }
];

// 奖励图标池 (小动物和水果) 及对应名称
const rewardIcons = [
    { icon: '🍎', name: '苹果' }, { icon: '🍐', name: '梨' }, 
    { icon: '🍊', name: '橘子' }, { icon: '🍋', name: '柠檬' }, 
    { icon: '🍌', name: '香蕉' }, { icon: '🍉', name: '西瓜' }, 
    { icon: '🍇', name: '葡萄' }, { icon: '🍓', name: '草莓' }, 
    { icon: '🍒', name: '樱桃' }, { icon: '🍑', name: '桃子' }, 
    { icon: '🥭', name: '芒果' }, { icon: '🍍', name: '菠萝' }, 
    { icon: '🥥', name: '椰子' }, { icon: '🥝', name: '猕猴桃' }, 
    { icon: '🍅', name: '西红柿' }, { icon: '🥑', name: '牛油果' }, 
    { icon: '🍏', name: '青苹果' }, { icon: '🐶', name: '小狗' }, 
    { icon: '🐱', name: '小猫' }, { icon: '🐭', name: '小老鼠' }, 
    { icon: '🐹', name: '仓鼠' }, { icon: '🐰', name: '小兔子' }, 
    { icon: '🦊', name: '狐狸' }, { icon: '🐻', name: '小熊' }, 
    { icon: '🐼', name: '熊猫' }, { icon: '🐨', name: '考拉' }, 
    { icon: '🐯', name: '老虎' }, { icon: '🦁', name: '狮子' }, 
    { icon: '🐮', name: '小牛' }, { icon: '🐷', name: '小猪' }, 
    { icon: '🐸', name: '青蛙' }, { icon: '🐵', name: '猴子' }
];

function getRandomRewardIcon() {
    return rewardIcons[Math.floor(Math.random() * rewardIcons.length)];
}

// 初始化音频上下文 (需在用户交互后初始化)
function initAudio() {
    if (!audioCtx) {
        audioCtx = new AudioContext();
    }
}

// Web Audio API 合成音效
function playSound(type) {
    if (!audioCtx) return;
    
    if (type === 'bomb') {
        const time = audioCtx.currentTime;
        const dur = 1.8; // 增加音效长度
        
        // 1. 爆炸主噪音（带有明显的起伏和长尾）
        const bufferSize = audioCtx.sampleRate * dur;
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            // 指数衰减噪音，使后半段平滑降低
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (audioCtx.sampleRate * 0.4));
        }
        const noise = audioCtx.createBufferSource();
        noise.buffer = buffer;
        
        const noiseFilter = audioCtx.createBiquadFilter();
        noiseFilter.type = 'lowpass';
        noiseFilter.frequency.setValueAtTime(3000, time);
        noiseFilter.frequency.exponentialRampToValueAtTime(50, time + dur);
        
        const noiseGain = audioCtx.createGain();
        noiseGain.gain.setValueAtTime(2.5, time);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, time + dur);
        
        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(audioCtx.destination);
        noise.start(time);
        
        // 2. 爆炸的低频轰鸣声（极低频的正弦波下潜）
        const osc = audioCtx.createOscillator();
        osc.type = 'triangle'; // 三角波在低频下听起来更厚实
        osc.frequency.setValueAtTime(120, time);
        osc.frequency.exponentialRampToValueAtTime(20, time + dur);
        
        const oscGain = audioCtx.createGain();
        oscGain.gain.setValueAtTime(2, time);
        oscGain.gain.exponentialRampToValueAtTime(0.01, time + dur);
        
        osc.connect(oscGain);
        oscGain.connect(audioCtx.destination);
        osc.start(time);
        osc.stop(time + dur);

        // 3. 开始的“裂开/引爆”瞬间高频冲击
        const crack = audioCtx.createOscillator();
        crack.type = 'square';
        crack.frequency.setValueAtTime(400, time);
        crack.frequency.exponentialRampToValueAtTime(50, time + 0.2);
        
        const crackGain = audioCtx.createGain();
        crackGain.gain.setValueAtTime(1.5, time);
        crackGain.gain.exponentialRampToValueAtTime(0.01, time + 0.2);
        
        crack.connect(crackGain);
        crackGain.connect(audioCtx.destination);
        crack.start(time);
        crack.stop(time + 0.2);
        
    } else if (type === 'coin' || type === 'gem') {
        // 模拟获得宝物的清脆提示音
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(type === 'coin' ? 800 : 1200, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(type === 'coin' ? 1200 : 2000, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.1);
    }
}

function getRandomItem() {
    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
    let random = Math.random() * totalWeight;
    for (const item of items) {
        if (random < item.weight) return item;
        random -= item.weight;
    }
    return items[0];
}

function updateStats() {
    document.getElementById('score').innerText = score.toFixed(2);
    
    // 检查剩余未点击格子比例
    const dugCells = document.querySelectorAll('.cell.dug').length;
    const remaining = totalCells - dugCells;
    if (remaining <= totalCells * 0.2) {
        document.getElementById('message').innerText = '剩余土块不足20%，自动进入下一局！';
        setTimeout(() => nextRound(), 1500); // 延迟一小会儿自动进入下一局
    }
}

function speakText(text) {
    // 如果浏览器支持语音合成
    if ('speechSynthesis' in window) {
        // 取消之前可能未完成的语音
        window.speechSynthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'zh-CN'; // 中文
        
        // 尝试寻找中文女声
        const voices = window.speechSynthesis.getVoices();
        // 不同浏览器和系统提供的声音名称不同，尽量匹配带有女声或中文标志的声音
        const femaleVoice = voices.find(voice => 
            voice.lang.includes('zh') && 
            (voice.name.includes('Xiaoxiao') || voice.name.includes('Ting-Ting') || voice.name.includes('female') || voice.name.includes('女'))
        );
        
        if (femaleVoice) {
            utterance.voice = femaleVoice;
        }
        
        // 稍微提高音调，让声音听起来更像女声/更活泼
        utterance.pitch = 1.2;
        utterance.rate = 1.0;
        
        window.speechSynthesis.speak(utterance);
    }
}

function dig(event) {
    initAudio(); // 确保音频上下文在点击后激活
    const cell = event.target;
    if (cell.classList.contains('dug')) return;

    const item = getRandomItem();
    cell.classList.add('dug');
    
    let displayIcon = item.emoji;
    let iconName = '';
    if (item.type === 'coin' || item.type === 'gem') {
        const reward = getRandomRewardIcon();
        displayIcon = reward.icon;
        iconName = reward.name;
    }

    if (item.type === 'bomb') {
        cell.classList.add('bomb-dug');
    }
    cell.innerText = displayIcon;
    
    if (item.type === 'coin' || item.type === 'gem') {
        const amount = parseFloat((Math.random() * 0.99 + 0.01).toFixed(2));
        document.getElementById('message').innerText = item.msg + ` 获得 ¥${amount}`;
        
        // 播放获取奖励的音效
        playSound(item.type);
        // 语音播报物品名称
        speakText(iconName);

        // 弹出图标并飞向总金额处的动画特效
        const cellRect = cell.getBoundingClientRect();
        const scoreSpan = document.getElementById('score');
        const scoreRect = scoreSpan.getBoundingClientRect();

        const floatEl = document.createElement('div');
        floatEl.className = 'fly-text';
        floatEl.innerText = displayIcon; // 这里改成了显示水果或动物图标
        
        // 起点：格子的中心
        const startX = cellRect.left + cellRect.width / 2;
        const startY = cellRect.top + cellRect.height / 2;
        // 终点：右上角总金额的中心
        const endX = scoreRect.left + scoreRect.width / 2;
        const endY = scoreRect.top + scoreRect.height / 2;
        
        floatEl.style.left = startX + 'px';
        floatEl.style.top = startY + 'px';
        document.body.appendChild(floatEl);

        // 使用 Web Animations API 实现分段动画
        // 放大比例从 1.5 增加到 2.0，使其看起来更清楚
        const anim = floatEl.animate([
            { transform: 'translate(-50%, -50%) scale(0.5)', opacity: 0 },
            { transform: 'translate(-50%, calc(-50% - 40px)) scale(2.0)', opacity: 1, offset: 0.3 }, // 弹起放大
            { transform: 'translate(-50%, calc(-50% - 40px)) scale(2.0)', opacity: 1, offset: 0.5 }, // 悬停展示一瞬间
            { transform: `translate(calc(-50% + ${endX - startX}px), calc(-50% + ${endY - startY}px)) scale(0.5)`, opacity: 0.2, offset: 1 } // 飞向总金额
        ], {
            duration: 1200,
            easing: 'ease-in-out'
        });

        // 动画结束时更新总金额并移除特效元素
        anim.onfinish = () => {
            floatEl.remove();
            score += amount;
            updateStats();
        };

    } else if (item.type === 'bomb') {
        document.getElementById('message').innerText = item.msg;
        
        // 获取炸弹格子的位置
        const cellRect = cell.getBoundingClientRect();
        const startX = cellRect.left + cellRect.width / 2;
        const startY = cellRect.top + cellRect.height / 2;

        // 创建炸弹弹出元素
        const bombEl = document.createElement('div');
        bombEl.className = 'bomb-pop';
        bombEl.innerText = '💣';
        bombEl.style.left = startX + 'px';
        bombEl.style.top = startY + 'px';
        document.body.appendChild(bombEl);

        // 炸弹弹跳变大动画，然后触发爆炸
        const anim = bombEl.animate([
            { transform: 'translate(-50%, -50%) scale(0.5)', offset: 0 },
            { transform: 'translate(-50%, calc(-50% - 60px)) scale(1.5)', offset: 0.5 }, // 弹起到最高点，变大
            { transform: 'translate(-50%, -50%) scale(2.5)', offset: 1 } // 砸回地面，变得很大，准备爆炸
        ], {
            duration: 600,
            easing: 'ease-in-out'
        });

        // 动画结束（炸弹砸地）时触发爆炸音效和震动
        anim.onfinish = () => {
            bombEl.remove();
            
            // 播放真实爆炸音效
            playSound('bomb');
            
            // 全屏柔和红光特效
            const flashEl = document.createElement('div');
            flashEl.className = 'flash';
            document.body.appendChild(flashEl);
            setTimeout(() => flashEl.remove(), 600);

            // 增强的屏幕震动
            document.body.classList.add('shake');
            setTimeout(() => document.body.classList.remove('shake'), 800);
            
            updateStats(); // 检查是否需要下一局
        };
    }
}

function nextRound() {
    document.getElementById('message').innerText = '新的一局开始啦！';
    document.body.classList.remove('shake');
    
    // 随机切换可爱的背景主题
    const randomTheme = Math.floor(Math.random() * 5);
    document.body.className = `bg-theme-${randomTheme}`;
    
    const grid = document.getElementById('grid');
    
    // 动态调整布局样式
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    
    // 简单美化：根据列数自动调整最大宽度，同时适配 iPad 等大屏
    const isTablet = window.innerWidth >= 768;
    const cellWidth = isTablet ? 90 : 66; // 大屏格子更大
    const minWidth = isTablet ? 450 : 280;
    const maxWidth = cols * cellWidth + 20; 
    const finalMaxWidth = `${Math.max(minWidth, maxWidth)}px`;
    grid.style.maxWidth = finalMaxWidth;
    document.getElementById('stats').style.maxWidth = finalMaxWidth;
    document.getElementById('message').style.maxWidth = finalMaxWidth;
    
    grid.innerHTML = '';
    for (let i = 0; i < totalCells; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.addEventListener('click', dig);
        grid.appendChild(cell);
    }
    updateStats();
}

// 设置面板逻辑
function openSettings() {
    document.getElementById('colCount').value = cols;
    document.getElementById('rowCount').value = rows;
    document.getElementById('settingsModal').style.display = 'flex';
}

function closeSettings() {
    document.getElementById('settingsModal').style.display = 'none';
}

function applySettings() {
    const newCols = parseInt(document.getElementById('colCount').value);
    const newRows = parseInt(document.getElementById('rowCount').value);
    
    if (newCols >= 3 && newCols <= 8 && newRows >= 3 && newRows <= 10) {
        cols = newCols;
        rows = newRows;
        totalCells = cols * rows;
        closeSettings();
        initGame(); // 重开游戏应用新设置
    } else {
        alert("列数需在3-8之间，行数需在3-10之间");
    }
}

function initGame() {
    score = 0;
    nextRound();
}

// 初始化语音合成，解决部分浏览器首次播报不发声的问题
function initSpeech() {
    if ('speechSynthesis' in window) {
        // 加载声音列表
        window.speechSynthesis.getVoices();
    }
}

window.onload = () => {
    initSpeech();
    initGame();
};