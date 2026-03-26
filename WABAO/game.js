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
        
        // 记录加分前的状态，用于检查是否跨越百位
        const oldScore = score;
        
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
            
            // 检查百分烟花彩蛋
            checkHundredEasterEgg(oldScore, score);
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
    
    const randomTheme = Math.floor(Math.random() * 5);
    Array.from(document.body.classList)
        .filter(c => c.startsWith('bg-theme-'))
        .forEach(c => document.body.classList.remove(c));
    document.body.classList.add(`bg-theme-${randomTheme}`);
    
    const grid = document.getElementById('grid');
    
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    
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
    
    lockScroll();
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

// ==========================================
// 彩蛋系统：百分烟花庆祝
// ==========================================
function triggerFireworks() {
    // 播放礼花音效
    if (audioCtx) {
        for(let i=0; i<3; i++) {
            setTimeout(() => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(300, audioCtx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.5);
                gain.gain.setValueAtTime(1, audioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start();
                osc.stop(audioCtx.currentTime + 0.5);
            }, i * 300);
        }
    }
    
    // 弹出提示
    const msgEl = document.getElementById('message');
    msgEl.innerText = `🎆 哇！你的分数突破了 ${Math.floor(score/100)*100} 分！太棒啦！ 🎆`;
    msgEl.style.backgroundColor = '#8e44ad';
    
    // 释放烟花
    for (let i = 0; i < 5; i++) {
        setTimeout(() => {
            const firework = document.createElement('div');
            firework.className = 'firework';
            // 随机位置
            firework.style.left = (20 + Math.random() * 60) + 'vw';
            firework.style.top = (20 + Math.random() * 40) + 'vh';
            // 随机大小和颜色偏移
            firework.style.transform = `translate(-50%, -50%) scale(${0.5 + Math.random()})`;
            document.body.appendChild(firework);
            
            setTimeout(() => firework.remove(), 1500);
        }, i * 400);
    }
}

function checkHundredEasterEgg(oldVal, newVal) {
    // 检查是否跨越了 100 的整数倍 (例如从 99 变成 101)
    const oldHundred = Math.floor(oldVal / 100);
    const newHundred = Math.floor(newVal / 100);
    
    if (newHundred > oldHundred && newHundred > 0) {
        triggerFireworks();
    }
}

// ==========================================
// 彩蛋系统：狐狸送礼
// ==========================================
let foxClickCount = 0;
let foxClickTimer = null;

function initFoxEasterEgg() {
    const foxEl = document.querySelector('.animal.fox');
    if (foxEl) {
        foxEl.addEventListener('click', () => {
            initAudio();
            
            // 如果狐狸已经是巨大状态，不响应点击
            if (foxEl.classList.contains('giant')) return;
            
            foxClickCount++;
            clearTimeout(foxClickTimer);
            
            // 播放狐狸叫声模拟（短促高音）
            if (audioCtx) {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(800 + foxClickCount * 100, audioCtx.currentTime);
                gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start();
                osc.stop(audioCtx.currentTime + 0.1);
            }
            
            // 狐狸受惊吓的微小动画反馈
            foxEl.style.transform = `scaleX(-1) scale(${1 + foxClickCount * 0.1}) translateY(${foxClickCount * -2}px)`;
            
            if (foxClickCount >= 3) {
                foxClickCount = 0;
                
                // 获取 footer 容器提升层级
                const footerEl = document.querySelector('.footer-decoration');
                if (footerEl) footerEl.classList.add('top-layer');
                
                // 狐狸巨大化
                foxEl.classList.add('giant');
                
                // 播放惊喜音效
                playSound('gem');
                
                // 给分
                const oldScore = score;
                score += 20;
                updateStats();
                
                const msgEl = document.getElementById('message');
                msgEl.innerText = '🦊 躲猫猫的狐狸被你发现了！送你 20 分！ 🦊';
                msgEl.style.backgroundColor = '#d35400';
                
                checkHundredEasterEgg(oldScore, score);
                
                // 3秒后狐狸恢复原样
                setTimeout(() => {
                    foxEl.classList.remove('giant');
                    foxEl.style.transform = ''; // 清除内联样式恢复CSS动画
                    if (footerEl) footerEl.classList.remove('top-layer');
                }, 3000);
                
            } else {
                foxClickTimer = setTimeout(() => {
                    foxClickCount = 0;
                    foxEl.style.transform = ''; // 恢复正常
                }, 2000);
            }
        });
    }
}

// ==========================================
// 彩蛋系统：连击标题触发“金币/糖果雨”
// ==========================================
let titleClickCount = 0;
let titleClickTimer = null;

function triggerEasterEgg() {
    // 播放彩蛋音效（类似大量金币的声音）
    playSound('gem');
    setTimeout(() => playSound('coin'), 200);
    setTimeout(() => playSound('gem'), 400);
    
    // 弹出提示
    const msgEl = document.getElementById('message');
    msgEl.innerText = '🎉 恭喜你发现了隐藏彩蛋：超级糖果雨！🎉';
    msgEl.style.backgroundColor = '#e84393';
    
    // 额外加分奖励
    score += 50;
    updateStats();
    
    // 下起金币和糖果雨
    const rainIcons = ['🍬', '🍭', '🍫', '🪙', '💎', '💰', '🌟'];
    const rainCount = 60; // 生成60个下落物
    
    for (let i = 0; i < rainCount; i++) {
        setTimeout(() => {
            const rainEl = document.createElement('div');
            rainEl.className = 'rain-item';
            // 随机选择一个图标
            rainEl.innerText = rainIcons[Math.floor(Math.random() * rainIcons.length)];
            
            // 随机水平位置 (0% 到 100%)
            rainEl.style.left = Math.random() * 100 + 'vw';
            
            // 随机大小
            const scale = 0.5 + Math.random() * 1;
            rainEl.style.transform = `scale(${scale})`;
            
            // 随机下落时间 (2s 到 5s)
            const duration = 2 + Math.random() * 3;
            rainEl.style.animationDuration = duration + 's';
            
            document.body.appendChild(rainEl);
            
            // 动画结束后移除元素
            setTimeout(() => {
                rainEl.remove();
            }, duration * 1000);
            
        }, Math.random() * 2000); // 在2秒内陆续生成
    }
}

function initEasterEgg() {
    const titleEl = document.getElementById('gameTitle');
    if (titleEl) {
        titleEl.addEventListener('click', () => {
            initAudio(); // 确保音频上下文激活
            titleClickCount++;
            
            // 如果点击了，重置计时器
            clearTimeout(titleClickTimer);
            
            // 每次点击播放一个小音效作为反馈
            if (audioCtx && titleClickCount < 3) {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'sine';
                // 音调随着点击次数逐渐升高
                osc.frequency.setValueAtTime(400 + titleClickCount * 50, audioCtx.currentTime);
                gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start();
                osc.stop(audioCtx.currentTime + 0.1);
            }
            
            if (titleClickCount >= 3) {
                titleClickCount = 0; // 重置
                triggerEasterEgg();
            } else {
                // 如果超过2秒没有继续点击，重置计数
                titleClickTimer = setTimeout(() => {
                    titleClickCount = 0;
                }, 2000);
            }
        });
    }
}

// ==========================================
// 彩蛋系统：兔子照片
// ==========================================
let bunnyClickCount = 0;
let bunnyClickTimer = null;

function initBunnyEasterEgg() {
    const bunnyEl = document.querySelector('.animal.bunny');
    if (bunnyEl) {
        bunnyEl.addEventListener('click', () => {
            initAudio();
            bunnyClickCount++;
            clearTimeout(bunnyClickTimer);
            
            // 每次点击播放类似兔子跳跃/叫声的音效
            if (audioCtx) {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(600 + bunnyClickCount * 50, audioCtx.currentTime);
                gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start();
                osc.stop(audioCtx.currentTime + 0.1);
            }
            
            // 兔子微小缩放反馈
            bunnyEl.style.transform = `scale(${1 + bunnyClickCount * 0.1})`;
            
            if (bunnyClickCount >= 10) {
                bunnyClickCount = 0;
                bunnyEl.style.transform = ''; // 恢复
                
                // 播放惊喜音效
                playSound('gem');
                
                // 弹出照片
                showPhotoOverlay();
            } else {
                bunnyClickTimer = setTimeout(() => {
                    bunnyClickCount = 0;
                    bunnyEl.style.transform = ''; // 恢复
                }, 2000);
            }
        });
    }
}

function showPhotoOverlay() {
    let overlay = document.getElementById('photoOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'photoOverlay';
        overlay.className = 'photo-overlay';
        
        const img = document.createElement('img');
        // 使用相对路径加载同目录下的 photo.jpg
        img.src = 'photo.jpg'; 
        img.alt = '惊喜照片';
        
        // 如果图片加载失败，显示提示文本
        img.onerror = () => {
            img.style.display = 'none';
            const errorMsg = document.createElement('div');
            errorMsg.className = 'error-msg';
            errorMsg.innerHTML = '📷 <b>照片未找到</b> 📷<br><br>请将您上传的照片重命名为 <span style="color:#e74c3c;">photo.jpg</span><br>并保存在游戏的同一个文件夹下哦！';
            overlay.appendChild(errorMsg);
        };
        
        overlay.appendChild(img);
        
        // 创建关闭按钮
        const closeBtn = document.createElement('div');
        closeBtn.className = 'photo-close-btn';
        closeBtn.innerHTML = '×';
        overlay.appendChild(closeBtn);
        
        document.body.appendChild(overlay);
        
        // 只有点击关闭按钮才会消失
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // 阻止事件冒泡
            overlay.classList.remove('show');
            setTimeout(() => {
                overlay.style.display = 'none';
                // 如果是加载失败导致的，清空内容以便下次重试加载
                if (img.style.display === 'none') {
                    overlay.remove();
                }
            }, 300);
        });
    }
    
    overlay.style.display = 'flex';
    // 强制重绘以触发过渡动画
    void overlay.offsetWidth;
    overlay.classList.add('show');
}

function initNoCopy() {
    const allowSelection = (el) => {
        if (!el || !el.tagName) return false;
        const tag = el.tagName.toLowerCase();
        return tag === 'input' || tag === 'textarea';
    };
    ['copy', 'cut', 'paste', 'contextmenu', 'dragstart'].forEach(evt => {
        document.addEventListener(evt, (e) => {
            if (allowSelection(e.target)) return;
            e.preventDefault();
        }, { passive: false });
    });
    document.addEventListener('selectstart', (e) => {
        if (allowSelection(e.target)) return;
        e.preventDefault();
    }, { passive: false });
}

let __scrollLocked = false;
function lockScroll() {
    if (__scrollLocked) return;
    __scrollLocked = true;
    document.body.classList.add('no-scroll');
    const block = (e) => e.preventDefault();
    window.addEventListener('wheel', block, { passive: false });
    window.addEventListener('touchmove', block, { passive: false });
    window.scrollTo(0, 0);
}

window.onload = () => {
    initNoCopy();
    initSpeech();
    initFoxEasterEgg();
    initBunnyEasterEgg();
    initEasterEgg();
    initGame();
};
