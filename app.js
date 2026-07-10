// ===== Cloud Quiz AR — Full Game Logic with Finger Tracking =====
(function () {
    'use strict';

    // ===================== STORAGE =====================
    const LESSONS_STORAGE_KEY = 'cloudquiz_lessons';
    const OLD_STORAGE_KEY = 'cloudquiz_questions';

    function loadLessons() {
        try {
            const raw = localStorage.getItem(LESSONS_STORAGE_KEY);
            if (raw) {
                return JSON.parse(raw);
            }
            
            // Try migration
            const oldRaw = localStorage.getItem(OLD_STORAGE_KEY);
            if (oldRaw) {
                const oldQuestions = JSON.parse(oldRaw);
                if (Array.isArray(oldQuestions) && oldQuestions.length > 0) {
                    const migrated = [{
                        id: 'migrated_' + Date.now(),
                        name: 'บทเรียนเดิม',
                        questions: oldQuestions
                    }];
                    localStorage.setItem(LESSONS_STORAGE_KEY, JSON.stringify(migrated));
                    return migrated;
                }
            }
            
            // Default first lesson
            const defaultLessons = [{
                id: 'default_' + Date.now(),
                name: 'บทเรียนที่ 1',
                questions: []
            }];
            localStorage.setItem(LESSONS_STORAGE_KEY, JSON.stringify(defaultLessons));
            return defaultLessons;
        } catch { 
            return [{
                id: 'default_error_' + Date.now(),
                name: 'บทเรียนที่ 1',
                questions: []
            }]; 
        }
    }

    function saveLessons(list) {
        localStorage.setItem(LESSONS_STORAGE_KEY, JSON.stringify(list));
    }

    // ===================== STATE =====================
    let lessons = loadLessons();
    let currentLessonIndex = 0;
    let questions = lessons[currentLessonIndex] ? lessons[currentLessonIndex].questions : [];
    
    let gameState = {
        currentIndex: 0,
        score: 0,
        answered: false,
    };

    // Interaction mode: 'finger' or 'touch'
    let interactionMode = 'finger';

    // Camera facing mode: 'environment' or 'user'
    let currentFacingMode = 'environment';

    // Hand tracking state
    let handTracker = null;
    let handTrackingReady = false;
    let handTrackingActive = false;
    let frameLoopId = null;
    let lastFingerPos = null; // { x, y } in screen coords
    let smoothPos = { x: 0, y: 0 }; // smoothed position

    // Dwell state
    const DWELL_TIME = 1500; // ms to hold on a cloud
    let dwellTarget = null; // index of cloud being dwelled on
    let dwellStart = 0;
    let dwellAnimFrame = null;

    // Trail
    let trailCounter = 0;

    // ===================== DOM =====================
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => document.querySelectorAll(s);

    // Screens
    const splashScreen = $('#splash-screen');
    const teacherScreen = $('#teacher-screen');
    const gameScreen = $('#game-screen');
    const lessonSelectScreen = $('#lesson-select-screen');

    // Splash
    const btnTeacher = $('#btn-teacher-mode');
    const btnStudent = $('#btn-student-mode');
    const splashStats = $('#splash-stats');

    // Lesson Select Screen
    const lessonSelectBack = $('#lesson-select-back');
    const lessonList = $('#lesson-list');

    // Teacher Lesson Selector Bar
    const lessonDropdown = $('#lesson-select-dropdown');
    const btnNewLesson = $('#btn-new-lesson');
    const btnRenameLesson = $('#btn-rename-lesson');
    const btnDeleteLesson = $('#btn-delete-lesson');

    // Teacher
    const teacherBack = $('#teacher-back');
    const questionForm = $('#question-form');
    const qTextInput = $('#q-text');
    const choiceInputs = $$('.choice-input');
    const correctToggles = $$('.correct-toggle');
    const submitBtn = $('#submit-btn');
    const questionList = $('#question-list');
    const clearAllBtn = $('#clear-all-btn');
    const headerCount = $('#header-count');

    // Image Upload DOM
    const uploadZone = $('#upload-zone');
    const qImageInput = $('#q-image-input');
    const uploadPrompt = $('#upload-prompt');
    const uploadPreviewContainer = $('#upload-preview-container');
    const uploadPreview = $('#upload-preview');
    const removePreviewBtn = $('#remove-preview-btn');

    // Game Image Display
    const qImageWrapper = $('#q-image-wrapper');
    const qImage = $('#q-image');

    // Image Modal DOM
    const imageModal = $('#image-modal');
    const modalImg = $('#modal-img');
    const modalCaption = $('#modal-caption');
    const closeModal = $('#close-modal');

    // Game
    const gameBack = $('#game-back');
    const cameraFeed = $('#camera-feed');
    const cameraFallback = $('#camera-fallback');
    const arOverlay = $('#ar-overlay');
    const hudCurrent = $('#hud-current');
    const hudTotal = $('#hud-total');
    const hudScoreNum = $('#hud-score-num');
    const qNumber = $('#q-number');
    const qDisplay = $('#q-display');
    const qHint = $('#q-hint');

    // Finger cursor
    const fingerCursor = $('#finger-cursor');
    const dwellProgressEl = $('#dwell-progress');
    const cursorLabel = $('#cursor-label');

    // Mode toggle
    const modeToggle = $('#mode-toggle');
    const modeIcon = $('#mode-icon');
    const modeLabel = $('#mode-label');

    // Camera toggle
    const cameraToggle = $('#camera-toggle');
    const cameraIcon = $('#camera-icon');
    const cameraLabel = $('#camera-label');

    // Hand loading
    const handLoading = $('#hand-loading');

    // Feedback
    const feedbackOverlay = $('#feedback-overlay');
    const feedbackCard = $('#feedback-card');
    const feedbackIcon = $('#feedback-icon');
    const feedbackText = $('#feedback-text');
    const feedbackCorrectAnswer = $('#feedback-correct-answer');
    const feedbackNext = $('#feedback-next');

    // Result
    const resultOverlay = $('#result-overlay');
    const resultStars = $('#result-stars');
    const resultEmoji = $('#result-emoji');
    const resultTitle = $('#result-title');
    const scoreCorrect = $('#score-correct');
    const scoreTotal = $('#score-total');
    const resultMessage = $('#result-message');
    const resultRetry = $('#result-retry');
    const resultHome = $('#result-home');

    // ===================== SCREEN NAV =====================
    function showScreen(screen) {
        [splashScreen, teacherScreen, gameScreen, lessonSelectScreen].forEach(s => {
            if (s) s.classList.remove('active');
        });
        if (screen) screen.classList.add('active');
    }

    // ===================== SPLASH =====================
    function updateSplashStats() {
        const totalLessons = lessons.length;
        const totalQuestions = lessons.reduce((sum, l) => sum + (l.questions ? l.questions.length : 0), 0);
        if (totalQuestions > 0) {
            splashStats.innerHTML = `<span class="stat-badge">📋 มี ${totalLessons} บทเรียน (${totalQuestions} ข้อ)</span>`;
        } else {
            splashStats.innerHTML = `<span class="stat-badge">📝 ยังไม่มีคำถาม — เพิ่มในโหมดครู</span>`;
        }
    }

    // ===================== TEACHER =====================
    let selectedCorrect = -1;
    let uploadedImageBase64 = null;

    function compressAndLoadImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const MAX_WIDTH = 600;
                    const MAX_HEIGHT = 600;
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > MAX_WIDTH) {
                            height *= MAX_WIDTH / width;
                            width = MAX_WIDTH;
                        }
                    } else {
                        if (height > MAX_HEIGHT) {
                            width *= MAX_HEIGHT / height;
                            height = MAX_HEIGHT;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;

                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
                    resolve(dataUrl);
                };
                img.onerror = (err) => reject(err);
            };
            reader.onerror = (err) => reject(err);
        });
    }

    function initTeacher() {
        renderLessonDropdown();
        renderQuestionList();
        resetForm();
    }

    function renderLessonDropdown() {
        lessonDropdown.innerHTML = '';
        lessons.forEach((l, idx) => {
            const opt = document.createElement('option');
            opt.value = idx;
            opt.textContent = `${l.name} (${l.questions ? l.questions.length : 0} ข้อ)`;
            if (idx === currentLessonIndex) {
                opt.selected = true;
            }
            lessonDropdown.appendChild(opt);
        });
    }

    function selectLesson(idx) {
        currentLessonIndex = idx;
        questions = lessons[currentLessonIndex] ? lessons[currentLessonIndex].questions : [];
        renderQuestionList();
        resetForm();
        renderLessonDropdown();
    }

    function createNewLesson() {
        const name = prompt('กรุณาใส่ชื่อบทเรียน/ชุดคำถามใหม่:');
        if (!name || !name.trim()) return;
        const newLesson = {
            id: 'lesson_' + Date.now(),
            name: name.trim(),
            questions: []
        };
        lessons.push(newLesson);
        saveLessons(lessons);
        selectLesson(lessons.length - 1);
    }

    // Exported for the event listener rename trigger
    function renameCurrentLesson() {
        const current = lessons[currentLessonIndex];
        if (!current) return;
        const newName = prompt('แก้ไขชื่อบทเรียน/ชุดคำถาม:', current.name);
        if (!newName || !newName.trim()) return;
        current.name = newName.trim();
        saveLessons(lessons);
        renderLessonDropdown();
    }

    function deleteCurrentLesson() {
        if (lessons.length <= 1) {
            alert('ต้องมีอย่างน้อย 1 บทเรียนเสมอ ไม่สามารถลบได้');
            return;
        }
        const current = lessons[currentLessonIndex];
        if (!confirm(`คุณแน่ใจหรือไม่ที่จะลบชุดคำถาม "${current.name}"?`)) return;
        lessons.splice(currentLessonIndex, 1);
        saveLessons(lessons);
        currentLessonIndex = Math.max(0, currentLessonIndex - 1);
        selectLesson(currentLessonIndex);
    }

    function resetForm() {
        qTextInput.value = '';
        choiceInputs.forEach(inp => inp.value = '');
        selectedCorrect = -1;
        correctToggles.forEach(t => {
            t.classList.remove('selected');
            t.textContent = '☆';
        });
        // Reset image upload
        uploadedImageBase64 = null;
        if (qImageInput) qImageInput.value = '';
        if (uploadPreview) uploadPreview.src = '';
        if (uploadPreviewContainer) uploadPreviewContainer.classList.add('hidden');
        if (uploadPrompt) uploadPrompt.classList.remove('hidden');
    }

    function renderQuestionList() {
        questionList.innerHTML = '';
        headerCount.textContent = `${questions.length} ข้อ`;

        if (questions.length === 0) {
            questionList.innerHTML = `
                <div class="empty-state">
                    <span class="empty-icon">📝</span>
                    <p>ยังไม่มีคำถาม</p>
                    <p class="empty-hint">เพิ่มคำถามด้านบนเพื่อเริ่มต้น!</p>
                </div>`;
            clearAllBtn.classList.add('hidden');
            return;
        }

        clearAllBtn.classList.remove('hidden');

        questions.forEach((q, i) => {
            const card = document.createElement('div');
            card.className = 'q-card';
            card.innerHTML = `
                <div class="q-card-header">
                    <span class="q-card-num">${i + 1}</span>
                    <div class="q-card-header-wrapper">
                        ${q.image ? `<img class="q-card-thumb" src="${q.image}" alt="thumbnail" title="แตะเพื่อขยาย">` : ''}
                        <span class="q-card-text">${escHtml(q.question)}</span>
                    </div>
                    <button class="q-card-delete" data-index="${i}" title="ลบ">✕</button>
                </div>
                <div class="q-card-choices">
                    ${q.choices.map((c, ci) =>
                `<span class="q-card-choice${ci === q.correctIndex ? ' correct' : ''}">${ci === q.correctIndex ? '✓ ' : ''}${escHtml(c)}</span>`
            ).join('')}
                </div>`;
            questionList.appendChild(card);
        });

        questionList.querySelectorAll('.q-card-thumb').forEach(thumb => {
            thumb.addEventListener('click', () => {
                openFullscreenImage(thumb.src, 'ภาพประกอบคำถาม');
            });
        });

        questionList.querySelectorAll('.q-card-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.dataset.index);
                questions.splice(idx, 1);
                saveLessons(lessons);
                renderQuestionList();
            });
        });
    }

    function handleFormSubmit(e) {
        e.preventDefault();

        const questionText = qTextInput.value.trim();
        if (!questionText) return;

        const allChoices = [];
        choiceInputs.forEach(inp => {
            const val = inp.value.trim();
            if (val) allChoices.push(val);
        });

        if (allChoices.length < 2) {
            shakeElement(submitBtn);
            alert('ต้องมีตัวเลือกอย่างน้อย 2 ตัวเลือก');
            return;
        }

        if (selectedCorrect < 0 || !choiceInputs[selectedCorrect].value.trim()) {
            shakeElement(submitBtn);
            alert('กรุณาเลือกคำตอบที่ถูกต้อง (กด ★)');
            return;
        }

        let correctIdx = 0;
        let nonEmptyIdx = 0;
        for (let i = 0; i < 4; i++) {
            if (choiceInputs[i].value.trim()) {
                if (i === selectedCorrect) { correctIdx = nonEmptyIdx; break; }
                nonEmptyIdx++;
            }
        }

        questions.push({
            question: questionText,
            choices: allChoices,
            correctIndex: correctIdx,
            image: uploadedImageBase64
        });
        saveLessons(lessons);
        renderQuestionList();
        resetForm();

        setTimeout(() => {
            document.querySelector('.teacher-body').scrollTop = 99999;
        }, 100);
    }

    // ===================== HAND TRACKING =====================
    async function initHandTracking() {
        if (typeof Hands === 'undefined') {
            console.warn('MediaPipe Hands not loaded, falling back to touch mode');
            setMode('touch');
            return;
        }

        handLoading.classList.remove('hidden');

        try {
            handTracker = new Hands({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`
            });

            handTracker.setOptions({
                maxNumHands: 1,
                modelComplexity: 0, // lite model for performance
                minDetectionConfidence: 0.6,
                minTrackingConfidence: 0.5,
            });

            handTracker.onResults(onHandResults);

            // Send a test frame to trigger model loading
            await handTracker.send({ image: cameraFeed });

            handTrackingReady = true;
            handLoading.classList.add('hidden');
            startFingerTracking();

        } catch (err) {
            console.warn('Hand tracking init failed:', err);
            handLoading.classList.add('hidden');
            setMode('touch');
        }
    }

    function startFingerTracking() {
        if (!handTrackingReady || handTrackingActive) return;
        handTrackingActive = true;
        processFrame();
    }

    function stopFingerTracking() {
        handTrackingActive = false;
        if (frameLoopId) {
            cancelAnimationFrame(frameLoopId);
            frameLoopId = null;
        }
        fingerCursor.classList.add('hidden');
        resetDwell();
    }

    let lastFrameTime = 0;
    const FRAME_INTERVAL = 80; // ~12fps for performance

    function processFrame() {
        if (!handTrackingActive) return;

        frameLoopId = requestAnimationFrame((timestamp) => {
            if (timestamp - lastFrameTime >= FRAME_INTERVAL) {
                lastFrameTime = timestamp;
                if (handTracker && cameraFeed.readyState >= 2) {
                    handTracker.send({ image: cameraFeed }).catch(() => { });
                }
            }
            processFrame();
        });
    }

    function onHandResults(results) {
        if (!handTrackingActive || gameState.answered) return;

        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const landmarks = results.multiHandLandmarks[0];
            const indexTip = landmarks[8]; // INDEX_FINGER_TIP

            // Convert normalized coords to screen coords
            const screenCoords = videoToScreen(indexTip.x, indexTip.y);

            // Smooth position
            const smoothing = 0.4;
            smoothPos.x = smoothPos.x + (screenCoords.x - smoothPos.x) * smoothing;
            smoothPos.y = smoothPos.y + (screenCoords.y - smoothPos.y) * smoothing;

            lastFingerPos = { x: smoothPos.x, y: smoothPos.y };

            // Update cursor
            showFingerCursor(smoothPos.x, smoothPos.y);

            // Spawn trail
            spawnTrail(smoothPos.x, smoothPos.y);

            // Check cloud hover
            checkCloudDwell(smoothPos.x, smoothPos.y);

        } else {
            // No hand detected
            hideFingerCursor();
            resetDwell();
        }
    }

    function videoToScreen(nx, ny) {
        // The video is displayed with object-fit: cover
        // We need to account for the aspect ratio mapping
        const vw = cameraFeed.videoWidth || 1280;
        const vh = cameraFeed.videoHeight || 720;
        const sw = window.innerWidth;
        const sh = window.innerHeight;

        const videoAspect = vw / vh;
        const screenAspect = sw / sh;

        let sx, sy;

        if (videoAspect > screenAspect) {
            // Video wider than screen — cropped on sides
            const visibleFrac = screenAspect / videoAspect;
            const offset = (1 - visibleFrac) / 2;
            sx = ((nx - offset) / visibleFrac) * sw;
            sy = ny * sh;
        } else {
            // Video taller — cropped top/bottom
            const visibleFrac = videoAspect / screenAspect;
            const offset = (1 - visibleFrac) / 2;
            sx = nx * sw;
            sy = ((ny - offset) / visibleFrac) * sh;
        }

        // Mirror X if using front (user-facing) camera because front feed is visually mirrored
        if (currentFacingMode === 'user') {
            sx = sw - sx;
        }

        return { x: sx, y: sy };
    }

    function showFingerCursor(x, y) {
        fingerCursor.classList.remove('hidden');
        fingerCursor.style.left = x + 'px';
        fingerCursor.style.top = y + 'px';
    }

    function hideFingerCursor() {
        fingerCursor.classList.add('hidden');
        fingerCursor.classList.remove('dwelling');
    }

    function spawnTrail(x, y) {
        trailCounter++;
        if (trailCounter % 3 !== 0) return; // Only every 3rd frame

        const dot = document.createElement('div');
        dot.className = 'finger-trail';
        dot.style.left = x + 'px';
        dot.style.top = y + 'px';
        dot.style.background = trailCounter % 6 === 0 ? 'var(--accent-light)' : 'var(--primary-light)';
        document.body.appendChild(dot);
        setTimeout(() => dot.remove(), 600);
    }

    // ===================== DWELL DETECTION =====================
    function checkCloudDwell(fx, fy) {
        const cloudEls = arOverlay.querySelectorAll('.ar-cloud');
        let hoveredIndex = -1;

        cloudEls.forEach((cloud, i) => {
            const rect = cloud.getBoundingClientRect();
            // Expand hit area slightly for easier targeting
            const pad = 15;
            if (fx >= rect.left - pad && fx <= rect.right + pad &&
                fy >= rect.top - pad && fy <= rect.bottom + pad) {
                hoveredIndex = i;
                cloud.classList.add('hovered');
            } else {
                cloud.classList.remove('hovered');
            }
        });

        if (hoveredIndex >= 0) {
            if (dwellTarget !== hoveredIndex) {
                // New target
                dwellTarget = hoveredIndex;
                dwellStart = performance.now();
                fingerCursor.classList.add('dwelling');
                cursorLabel.textContent = '⏳';
            }

            // Update dwell progress
            const elapsed = performance.now() - dwellStart;
            const progress = Math.min(elapsed / DWELL_TIME, 1);
            const circumference = 163.36; // 2 * PI * 26
            dwellProgressEl.style.strokeDashoffset = circumference * (1 - progress);

            if (progress >= 1) {
                // Dwell complete! Select this cloud
                const cloud = cloudEls[hoveredIndex];
                const choiceIndex = parseInt(cloud.dataset.index);
                const correctIndex = parseInt(cloud.dataset.correct) === 1 ?
                    choiceIndex : getCorrectIndex();

                fingerCursor.classList.remove('dwelling');
                cursorLabel.textContent = '👆';
                resetDwell();

                handleCloudSelect(cloud, choiceIndex);
            }
        } else {
            // No cloud hovered
            if (dwellTarget !== null) {
                resetDwell();
            }
        }
    }

    function getCorrectIndex() {
        const q = questions[gameState.currentIndex];
        return q ? q.correctIndex : 0;
    }

    function resetDwell() {
        dwellTarget = null;
        dwellStart = 0;
        dwellProgressEl.style.strokeDashoffset = 163.36;
        fingerCursor.classList.remove('dwelling');
        cursorLabel.textContent = '👆';

        arOverlay.querySelectorAll('.ar-cloud').forEach(c => c.classList.remove('hovered'));
    }

    // ===================== MODE TOGGLE =====================
    function setMode(mode) {
        interactionMode = mode;
        if (mode === 'finger') {
            modeIcon.textContent = '👆';
            modeLabel.textContent = 'นิ้วชี้';
            qHint.textContent = '👆 ชี้นิ้วค้างไว้ที่ก้อนเมฆคำตอบ!';
            if (handTrackingReady) startFingerTracking();
        } else {
            modeIcon.textContent = '👋';
            modeLabel.textContent = 'แตะจอ';
            qHint.textContent = '👋 แตะก้อนเมฆคำตอบที่ถูกต้อง!';
            stopFingerTracking();
        }
    }

    // ===================== GAME =====================
    async function startGame() {
        if (questions.length === 0) {
            alert('ยังไม่มีคำถาม! ไปที่โหมดครูเพื่อเพิ่มคำถามก่อน');
            return;
        }

        showScreen(gameScreen);

        gameState = { currentIndex: 0, score: 0, answered: false };
        hudTotal.textContent = questions.length;
        hudScoreNum.textContent = '0';

        await initCamera();
        showQuestion(0);

        // Initialize hand tracking if in finger mode
        if (interactionMode === 'finger') {
            // Small delay to let camera stabilize
            setTimeout(() => initHandTracking(), 500);
        }
    }

    async function initCamera() {
        try {
            if (cameraFeed.srcObject) {
                cameraFeed.srcObject.getTracks().forEach(t => t.stop());
                cameraFeed.srcObject = null;
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: currentFacingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: false
            });
            cameraFeed.srcObject = stream;
            cameraFeed.style.display = '';

            // Apply visual mirror if using front camera
            if (currentFacingMode === 'user') {
                cameraFeed.classList.add('mirrored');
            } else {
                cameraFeed.classList.remove('mirrored');
            }

            await cameraFeed.play();
            cameraFallback.classList.add('hidden');
        } catch (err) {
            console.error('initCamera error:', err);
            cameraFeed.style.display = 'none';
            cameraFallback.classList.remove('hidden');
            cameraFallback.innerHTML = '';
            for (let i = 0; i < 50; i++) {
                const star = document.createElement('div');
                star.className = 'star';
                star.style.left = Math.random() * 100 + '%';
                star.style.top = Math.random() * 100 + '%';
                star.style.animationDelay = Math.random() * 3 + 's';
                cameraFallback.appendChild(star);
            }
            // No camera means no finger tracking
            setMode('touch');
        }
    }

    function stopCamera() {
        if (cameraFeed.srcObject) {
            cameraFeed.srcObject.getTracks().forEach(t => t.stop());
            cameraFeed.srcObject = null;
        }
    }

    async function toggleCamera() {
        if (gameState.answered) return; // Prevent glitches during feedback
        
        currentFacingMode = (currentFacingMode === 'environment') ? 'user' : 'environment';
        
        if (cameraLabel) {
            cameraLabel.textContent = currentFacingMode === 'environment' ? 'กล้องหลัง' : 'กล้องหน้า';
        }
        
        await initCamera();
        
        if (interactionMode === 'finger' && handTrackingActive) {
            stopFingerTracking();
            startFingerTracking();
        }
    }

    function showQuestion(index) {
        gameState.currentIndex = index;
        gameState.answered = false;

        const q = questions[index];
        hudCurrent.textContent = index + 1;
        qNumber.textContent = `ข้อ ${index + 1}`;
        qDisplay.textContent = q.question;

        // Show/hide game question image
        if (q.image) {
            qImage.src = q.image;
            qImageWrapper.classList.remove('hidden');
        } else {
            qImage.src = '';
            qImageWrapper.classList.add('hidden');
        }

        if (interactionMode === 'finger') {
            qHint.textContent = '👆 ชี้นิ้วค้างไว้ที่ก้อนเมฆคำตอบ!';
        } else {
            qHint.textContent = '👋 แตะก้อนเมฆคำตอบที่ถูกต้อง!';
        }

        resetDwell();
        generateClouds(q.choices, q.correctIndex);
    }

    function openFullscreenImage(src, captionText) {
        modalImg.src = src;
        modalCaption.textContent = captionText || '';
        imageModal.classList.remove('hidden');
    }

    function closeFullscreenImage() {
        imageModal.classList.add('hidden');
        modalImg.src = '';
    }

    // ===================== CLOUD GENERATION =====================
    function generateClouds(choices, correctIndex) {
        arOverlay.innerHTML = '';

        const positions = calcPositions(choices.length);
        const letters = ['A', 'B', 'C', 'D'];

        choices.forEach((choice, i) => {
            const cloud = document.createElement('div');
            cloud.className = 'ar-cloud';
            cloud.style.left = positions[i].x + 'px';
            cloud.style.top = positions[i].y + 'px';
            cloud.dataset.index = i;
            cloud.dataset.correct = (i === correctIndex) ? '1' : '0';

            cloud.innerHTML = `
                <div class="cloud-inner">
                    <span class="cloud-sparkle">✦</span>
                    <span class="cloud-sparkle">✧</span>
                    <span class="cloud-sparkle">✦</span>
                    <div class="cloud-shape">
                        <div class="cloud-label">
                            <p class=""cloud-letter"> ${letters[i]} . ${escHtml(choice)}</p>
                        </div>
                    </div>
                </div>`;

            // Touch/click handler (always works as fallback)
            const handler = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!gameState.answered) {
                    handleCloudSelect(cloud, i);
                }
            };
            cloud.addEventListener('click', handler);
            cloud.addEventListener('touchend', handler, { passive: false });

            arOverlay.appendChild(cloud);
        });
    }

    function calcPositions(count) {
        const W = window.innerWidth;
        const H = window.innerHeight;
        const cloudW = W * 0.44;
        const cloudH = 140;
        const padX = 6;
        const topMin = 60;
        const bottomMax = H - 200;
        const positions = [];

        if (count <= 2) {
            const centerY = topMin;
            if (count === 1) {
                positions.push({ x: W / 2 - cloudW / 2, y: centerY });
            } else {
                // Left and right side by side
                positions.push({ x: padX, y: centerY });
                positions.push({ x: W - cloudW - padX, y: centerY });
            }
        } else if (count === 3) {
            positions.push({ x: W / 2 - cloudW / 2, y: topMin + 10 });
            positions.push({ x: padX, y: topMin + (bottomMax - topMin) * 0.5 });
            positions.push({ x: W - cloudW - padX, y: topMin + (bottomMax - topMin) * 0.5 + 30 });
        } else {
            const colW = (W - padX * 2) / 2;
            const rowH = (bottomMax - topMin) / 2;
            for (let i = 0; i < count; i++) {
                const col = i % 2;
                const row = Math.floor(i / 2);
                positions.push({
                    x: padX + col * colW + (colW - cloudW) / 2,
                    y: topMin + row * rowH + 10 + (col % 2 === 0 ? 0 : 25)
                });
            }
        }

        positions.forEach(p => {
            p.x = Math.max(padX, Math.min(W - cloudW - padX, p.x));
            p.y = Math.max(topMin, Math.min(bottomMax - cloudH, p.y));
        });

        return positions;
    }

    // ===================== ANSWER HANDLING =====================
    function handleCloudSelect(cloudEl, choiceIndex) {
        if (gameState.answered) return;
        gameState.answered = true;

        // Stop dwell detection
        resetDwell();
        if (interactionMode === 'finger') {
            stopFingerTracking();
        }

        const q = questions[gameState.currentIndex];
        const correctIndex = q.correctIndex;
        const isCorrect = choiceIndex === correctIndex;

        // Ripple
        const rect = cloudEl.getBoundingClientRect();
        const ripple = document.createElement('div');
        ripple.className = 'tap-ripple';
        ripple.style.left = (rect.left + rect.width / 2) + 'px';
        ripple.style.top = (rect.top + rect.height / 2) + 'px';
        arOverlay.appendChild(ripple);
        setTimeout(() => ripple.remove(), 700);

        cloudEl.classList.add('tapped');

        // Mark correct/wrong
        setTimeout(() => {
            arOverlay.querySelectorAll('.ar-cloud').forEach(c => {
                if (c.dataset.correct === '1') c.classList.add('correct');
            });
            if (!isCorrect) cloudEl.classList.add('wrong');
        }, 200);

        // Vibrate
        if (navigator.vibrate) {
            navigator.vibrate(isCorrect ? [40, 20, 40] : [100, 50, 100, 50, 100]);
        }

        if (isCorrect) gameState.score++;
        hudScoreNum.textContent = gameState.score;

        setTimeout(() => showFeedback(isCorrect, correctIndex), 700);
    }

    function showFeedback(isCorrect, correctIndex) {
        const q = questions[gameState.currentIndex];

        feedbackCard.className = 'feedback-card ' + (isCorrect ? 'correct-card' : 'wrong-card');
        feedbackIcon.textContent = isCorrect ? '✅' : '❌';
        feedbackText.textContent = isCorrect ? 'ถูกต้อง! เก่งมาก!' : 'ผิดนะ ลองดูคำตอบที่ถูก';
        feedbackText.className = 'feedback-text ' + (isCorrect ? 'text-correct' : 'text-wrong');

        feedbackCorrectAnswer.innerHTML = isCorrect ? '' :
            `คำตอบที่ถูก: <strong style="color:var(--green-light)">${escHtml(q.choices[correctIndex])}</strong>`;

        const isLast = gameState.currentIndex >= questions.length - 1;
        feedbackNext.textContent = isLast ? '🏆 ดูผลคะแนน' : 'ข้อถัดไป →';

        feedbackOverlay.classList.remove('hidden');
        if (isCorrect) spawnConfetti(15);
    }

    function hideFeedback() {
        feedbackOverlay.classList.add('hidden');
    }

    // ===================== RESULT =====================
    function showResult() {
        const total = questions.length;
        const correct = gameState.score;
        const pct = total > 0 ? correct / total : 0;

        scoreCorrect.textContent = correct;
        scoreTotal.textContent = total;

        let stars = pct >= 0.9 ? '⭐⭐⭐' : pct >= 0.7 ? '⭐⭐' : pct >= 0.4 ? '⭐' : '';
        resultStars.textContent = stars;

        if (pct >= 0.9) {
            resultEmoji.textContent = '🏆';
            resultTitle.textContent = 'ยอดเยี่ยม!';
            resultMessage.textContent = 'คุณเก่งมากๆ เลย ทำได้ดีที่สุด! 🎉';
        } else if (pct >= 0.7) {
            resultEmoji.textContent = '🎉';
            resultTitle.textContent = 'เก่งมาก!';
            resultMessage.textContent = 'ทำได้ดีเลย ลองทำให้ครบกันนะ!';
        } else if (pct >= 0.4) {
            resultEmoji.textContent = '💪';
            resultTitle.textContent = 'พยายามดี!';
            resultMessage.textContent = 'ลองอ่านทบทวนแล้วมาเล่นอีกครั้ง!';
        } else {
            resultEmoji.textContent = '📖';
            resultTitle.textContent = 'ไม่เป็นไร!';
            resultMessage.textContent = 'ลองทบทวนบทเรียนแล้วกลับมาใหม่นะ 💜';
        }

        resultOverlay.classList.remove('hidden');
        if (pct >= 0.7) spawnConfetti(30);
    }

    function hideResult() {
        resultOverlay.classList.add('hidden');
    }

    // ===================== CONFETTI =====================
    function spawnConfetti(count) {
        const colors = ['#a78bfa', '#67e8f9', '#fcd34d', '#f0abfc', '#6ee7b7', '#fda4af'];
        for (let i = 0; i < count; i++) {
            const c = document.createElement('div');
            c.className = 'confetti';
            c.style.left = (Math.random() * 100) + '%';
            c.style.top = '-10px';
            c.style.background = colors[Math.floor(Math.random() * colors.length)];
            c.style.width = (5 + Math.random() * 6) + 'px';
            c.style.height = (5 + Math.random() * 6) + 'px';
            c.style.animationDuration = (1.5 + Math.random() * 2) + 's';
            c.style.animationDelay = (Math.random() * 0.5) + 's';
            document.body.appendChild(c);
            setTimeout(() => c.remove(), 4000);
        }
    }

    // ===================== HELPERS =====================
    function escHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function shakeElement(el) {
        el.style.animation = 'none';
        el.offsetHeight;
        el.style.animation = 'shake 0.4s ease-out';
        setTimeout(() => el.style.animation = '', 400);
        if (!document.querySelector('#shake-ks')) {
            const s = document.createElement('style');
            s.id = 'shake-ks';
            s.textContent = `@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}50%{transform:translateX(6px)}75%{transform:translateX(-4px)}}`;
            document.head.appendChild(s);
        }
    }

    function cleanupGame() {
        stopFingerTracking();
        stopCamera();
        feedbackOverlay.classList.add('hidden');
        resultOverlay.classList.add('hidden');
        handTrackingReady = false;
        handTracker = null;
        currentFacingMode = 'environment';
        if (cameraLabel) cameraLabel.textContent = 'สลับกล้อง';
        cameraFeed.classList.remove('mirrored');
    }

    // ===================== LESSON SELECTION =====================
    function showLessonSelect() {
        showScreen(lessonSelectScreen);
        renderLessonList();
    }

    function renderLessonList() {
        lessonList.innerHTML = '';
        if (lessons.length === 0) {
            lessonList.innerHTML = `
                <div class="lesson-empty">
                    <span class="lesson-empty-icon">📖</span>
                    <p class="lesson-empty-text">ยังไม่มีบทเรียน</p>
                    <p class="lesson-empty-hint">เข้าโหมดครูเพื่อเพิ่มบทเรียนก่อนนะ!</p>
                </div>`;
            return;
        }

        const emojis = ['📚', '🪐', '🧬', '🧪', '🧭', '📐', '🧠', '🎨', '🎬', '🧩'];
        lessons.forEach((l, idx) => {
            const count = l.questions ? l.questions.length : 0;
            const emoji = emojis[idx % emojis.length];
            const card = document.createElement('div');
            card.className = 'lesson-card';
            card.innerHTML = `
                <div class="lesson-card-inner">
                    <span class="lesson-card-emoji">${emoji}</span>
                    <div class="lesson-card-info">
                        <h3 class="lesson-card-name">${escHtml(l.name)}</h3>
                        <span class="lesson-card-count">📝 ${count} ข้อ</span>
                    </div>
                    <span class="lesson-card-arrow">→</span>
                </div>`;
            
            card.addEventListener('click', () => {
                if (count === 0) {
                    alert('บทเรียนนี้ยังไม่มีคำถาม กรุณาเพิ่มคำถามในโหมดครูก่อน');
                    return;
                }
                currentLessonIndex = idx;
                questions = l.questions;
                startGame();
            });

            lessonList.appendChild(card);
        });
    }

    // ===================== EVENT LISTENERS =====================
    function init() {
        updateSplashStats();

        // Splash
        btnTeacher.addEventListener('click', () => {
            showScreen(teacherScreen);
            initTeacher();
        });

        btnStudent.addEventListener('click', () => {
            showLessonSelect();
        });

        // Lesson Select Screen
        lessonSelectBack.addEventListener('click', () => {
            showScreen(splashScreen);
            updateSplashStats();
        });

        // Teacher Lesson Selector Bar
        lessonDropdown.addEventListener('change', (e) => {
            selectLesson(parseInt(e.target.value));
        });

        btnNewLesson.addEventListener('click', createNewLesson);
        btnRenameLesson.addEventListener('click', renameCurrentLesson);
        btnDeleteLesson.addEventListener('click', deleteCurrentLesson);

        // Teacher
        teacherBack.addEventListener('click', () => {
            showScreen(splashScreen);
            updateSplashStats();
        });

        correctToggles.forEach(toggle => {
            toggle.addEventListener('click', () => {
                const idx = parseInt(toggle.dataset.index);
                selectedCorrect = idx;
                correctToggles.forEach(t => {
                    t.classList.remove('selected');
                    t.textContent = '☆';
                });
                toggle.classList.add('selected');
                toggle.textContent = '★';
            });
        });

        questionForm.addEventListener('submit', (e) => {
            handleFormSubmit(e);
            renderLessonDropdown(); // Update the count in selector bar
        });

        // Image Upload Helper
        async function handleImageFile(file) {
            try {
                uploadPrompt.classList.add('hidden');
                uploadPreviewContainer.classList.remove('hidden');
                uploadPreview.src = 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns%3D\'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg\' viewBox%3D\'0 0 100 100\'%3E%3Ccircle cx%3D\'50\' cy%3D\'50\' r%3D\'40\' stroke%3D\'%237c3aed\' stroke-width%3D\'8\' fill%3D\'none\' stroke-dasharray%3D\'180\' stroke-dashoffset%3D\'0\'%3E%3CanimateTransform attributeName%3D\'transform\' type%3D\'rotate\' from%3D\'0 50 50\' to%3D\'360 50 50\' dur%3D\'1s\' repeatCount%3D\'indefinite\'%2F%3E%3C%2Fcircle%3E%3C%2Fsvg%3E';

                const compressedBase64 = await compressAndLoadImage(file);
                uploadedImageBase64 = compressedBase64;
                uploadPreview.src = compressedBase64;
            } catch (err) {
                console.error('Error uploading/compressing image:', err);
                alert('ไม่สามารถประมวลผลรูปภาพนี้ได้ กรุณาลองใช้รูปอื่น');
                resetImageUpload();
            }
        }

        function resetImageUpload() {
            uploadedImageBase64 = null;
            qImageInput.value = '';
            uploadPreview.src = '';
            uploadPreviewContainer.classList.add('hidden');
            uploadPrompt.classList.remove('hidden');
        }

        // Image Upload Handlers
        uploadZone.addEventListener('click', () => {
            qImageInput.click();
        });

        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('dragover');
        });

        uploadZone.addEventListener('dragleave', () => {
            uploadZone.classList.remove('dragover');
        });

        uploadZone.addEventListener('drop', async (e) => {
            e.preventDefault();
            uploadZone.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type.startsWith('image/')) {
                await handleImageFile(files[0]);
            }
        });

        qImageInput.addEventListener('change', async () => {
            const files = qImageInput.files;
            if (files.length > 0) {
                await handleImageFile(files[0]);
            }
        });

        removePreviewBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            resetImageUpload();
        });

        // Fullscreen Modal Listeners
        closeModal.addEventListener('click', closeFullscreenImage);
        imageModal.addEventListener('click', (e) => {
            if (e.target === imageModal || e.target === closeModal) {
                closeFullscreenImage();
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeFullscreenImage();
            }
        });

        // Open fullscreen when game image is clicked
        qImage.addEventListener('click', () => {
            const q = questions[gameState.currentIndex];
            if (q && q.image) {
                openFullscreenImage(q.image, q.question);
            }
        });

        clearAllBtn.addEventListener('click', () => {
            if (confirm('ลบคำถามทั้งหมดในบทเรียนนี้?')) {
                questions.length = 0;
                saveLessons(lessons);
                renderQuestionList();
                renderLessonDropdown();
            }
        });

        // Game
        gameBack.addEventListener('click', () => {
            cleanupGame();
            showLessonSelect();
        });

        // Mode toggle
        modeToggle.addEventListener('click', () => {
            if (interactionMode === 'finger') {
                setMode('touch');
            } else {
                setMode('finger');
                if (!handTrackingReady) {
                    initHandTracking();
                }
            }
        });

        // Camera toggle
        cameraToggle.addEventListener('click', toggleCamera);

        // Feedback
        feedbackNext.addEventListener('click', () => {
            hideFeedback();
            const nextIdx = gameState.currentIndex + 1;
            if (nextIdx >= questions.length) {
                showResult();
            } else {
                showQuestion(nextIdx);
                // Restart finger tracking for next question
                if (interactionMode === 'finger' && handTrackingReady) {
                    startFingerTracking();
                }
            }
        });

        // Result
        resultRetry.addEventListener('click', () => {
            hideResult();
            gameState = { currentIndex: 0, score: 0, answered: false };
            hudScoreNum.textContent = '0';
            showQuestion(0);
            if (interactionMode === 'finger' && handTrackingReady) {
                startFingerTracking();
            }
        });

        resultHome.addEventListener('click', () => {
            hideResult();
            cleanupGame();
            showScreen(splashScreen);
            updateSplashStats();
        });

        // Prevent double-tap zoom
        document.addEventListener('dblclick', e => e.preventDefault());

        // Orientation change
        window.addEventListener('orientationchange', () => {
            if (gameScreen.classList.contains('active') && !gameState.answered) {
                setTimeout(() => {
                    const q = questions[gameState.currentIndex];
                    if (q) generateClouds(q.choices, q.correctIndex);
                }, 400);
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
