// ===== Fluid Neural Orb Scene Module =====
// Three.js 3D scene with morphing iridescent sphere, mouse interaction, and talking animation

import { createNoise3D } from 'simplex-noise';

const CrownScene = (function() {
    let THREE = null;
    let scene, camera, renderer, composer;
    let orbGroup = null;
    let orbMesh = null;
    let waveMeshes = [];  // Ocean wave planes (horizontal layers)
    let clock = null;
    let animationId = null;
    let canvas = null;
    let isInitialized = false;
    let reducedMotion = false;
    let isDarkTheme = true;

    // Noise generator
    let noise3D = null;

    // Geometry data for morphing
    let basePositions = null;
    let baseNormals = null;

    // State
    let crownState = 'idle'; // idle | analyzing | autonomous | pulsing
    let glowIntensity = 1.0;
    let targetGlowIntensity = 1.0;
    let pulseDecay = 0;

    // Mouse tracking
    let mouseX = 0, mouseY = 0;
    let mouseWorldPos = null;
    let raycaster = null;
    let mouseNDC = null;
    let cameraBaseX = 0, cameraBaseY = 0.15, cameraBaseZ = 3;

    // Galaxy starfield
    let galaxyGroup = null;
    let starField = null;
    let isDragging = false;
    let dragStart = { x: 0, y: 0 };
    let galaxyRotation = { x: 0.1, y: 0 };

    // AGI "alive" behavior state
    let mouseVelocity = { x: 0, y: 0 };
    let lastMousePos = { x: 0, y: 0 };
    let lastInteractionTime = 0;
    let isContentMode = false;
    let orbBaseY = 0;  // For breathing + bounce combination

    // Orb physics state (drag-to-spin)
    let orbDragging = false;
    let orbDragStart = { x: 0, y: 0 };
    let orbAngularVelocity = { x: 0, y: 0 };
    const ORB_FRICTION = 0.98;           // 2% decay per frame
    const ORB_DRAG_SENSITIVITY = 0.008;  // Radians per pixel
    const ORB_MAX_VELOCITY = 0.15;       // Max spin speed
    const ORB_INERTIA_THRESHOLD = 0.001; // Below this, return to auto-rotation

    async function init(canvasElement) {
        canvas = canvasElement;
        reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        // Load Three.js dynamically
        THREE = await import('three');
        CrownMaterials.setTHREE(THREE);

        // Initialize noise
        noise3D = createNoise3D();

        // Initialize raycaster
        raycaster = new THREE.Raycaster();
        mouseNDC = new THREE.Vector2();
        mouseWorldPos = new THREE.Vector3(0, 0, 10); // Start far away

        setupScene();
        setupCamera();
        setupRenderer();
        setupLighting();
        buildGalaxy();      // Galaxy behind the orb
        buildFluidOrb();
        await setupPostProcessing();

        // Create procedural environment for reflections
        createEnvironment();

        clock = new THREE.Clock();
        isInitialized = true;
        lastInteractionTime = 0;

        // Event listeners
        window.addEventListener('resize', handleResize);
        canvas.addEventListener('mousemove', handleMouseMove);
        canvas.addEventListener('mouseleave', handleMouseLeave);
        canvas.addEventListener('mousedown', handleMouseDown);
        canvas.addEventListener('mouseup', handleMouseUp);
        canvas.addEventListener('mouseenter', handleMouseEnter);
        canvas.addEventListener('click', handleClick);
        document.addEventListener('visibilitychange', handleVisibility);

        canvas.style.cursor = 'grab';
        handleResize();

        if (reducedMotion) {
            // Render a single static frame
            renderFrame();
        } else {
            animate();
        }

        // Signal ready
        window.dispatchEvent(new Event('crown-ready'));
    }

    function setupScene() {
        scene = new THREE.Scene();
        // Transparent background — CSS gradient behind the canvas
    }

    function setupCamera() {
        const aspect = canvas.clientWidth / canvas.clientHeight;
        camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100);
        camera.position.set(cameraBaseX, cameraBaseY, cameraBaseZ);
        camera.lookAt(0, 0, 0);
    }

    function setupRenderer() {
        renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance',
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(canvas.clientWidth, canvas.clientHeight);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.2;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
    }

    function setupLighting() {
        // Soft ambient
        const ambient = new THREE.AmbientLight(0xb8a9e8, 0.5);
        scene.add(ambient);

        // Main directional
        const dir = new THREE.DirectionalLight(0xffffff, 1.2);
        dir.position.set(2, 3, 2);
        scene.add(dir);

        // Purple accent
        const purple = new THREE.PointLight(0x7c3aed, 0.8, 10);
        purple.position.set(-2, 1, -1);
        scene.add(purple);

        // Cyan accent
        const cyan = new THREE.PointLight(0x06b6d4, 0.4, 10);
        cyan.position.set(2, -1, 1);
        scene.add(cyan);

        // Pink accent (for more color variety)
        const pink = new THREE.PointLight(0xec4899, 0.3, 10);
        pink.position.set(0, -2, 2);
        scene.add(pink);

        // Divine top light
        const spot = new THREE.SpotLight(0xffffff, 0.8, 10, Math.PI / 8, 0.5);
        spot.position.set(0, 4, 0);
        spot.target.position.set(0, 0, 0);
        scene.add(spot);
        scene.add(spot.target);
    }

    function buildGalaxy() {
        galaxyGroup = new THREE.Group();

        // Stars — 3000 points at varying distances
        const starCount = 3000;
        const starPositions = new Float32Array(starCount * 3);
        const starColors = new Float32Array(starCount * 3);

        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;
            // Spherical distribution at varying distances (5 to 30 units)
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const r = 5 + Math.random() * 25;

            starPositions[i3] = r * Math.sin(phi) * Math.cos(theta);
            starPositions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            starPositions[i3 + 2] = r * Math.cos(phi);

            // Color variation — mostly white, some blue/purple tints
            const colorChoice = Math.random();
            if (colorChoice < 0.7) {
                starColors[i3] = 1; starColors[i3 + 1] = 1; starColors[i3 + 2] = 1; // White
            } else if (colorChoice < 0.85) {
                starColors[i3] = 0.7; starColors[i3 + 1] = 0.8; starColors[i3 + 2] = 1; // Blue
            } else {
                starColors[i3] = 0.9; starColors[i3 + 1] = 0.7; starColors[i3 + 2] = 1; // Purple
            }
        }

        const starGeometry = new THREE.BufferGeometry();
        starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
        starGeometry.setAttribute('color', new THREE.BufferAttribute(starColors, 3));

        const starMaterial = new THREE.PointsMaterial({
            size: 0.04,           // Slightly smaller
            vertexColors: true,
            transparent: true,
            opacity: isDarkTheme ? 0.4 : 0.1,  // Reduced from 0.8/0.15
            sizeAttenuation: true,
        });

        starField = new THREE.Points(starGeometry, starMaterial);
        galaxyGroup.add(starField);

        scene.add(galaxyGroup);
    }

    function buildFluidOrb() {
        orbGroup = new THREE.Group();

        // Higher resolution sphere for smooth morphing (outer shell)
        const geometry = new THREE.SphereGeometry(0.75, 96, 96);

        // Store base positions for morphing
        const posAttr = geometry.attributes.position;
        basePositions = new Float32Array(posAttr.array);
        baseNormals = new Float32Array(geometry.attributes.normal.array);

        // Create mesh with shell material
        orbMesh = new THREE.Mesh(geometry, CrownMaterials.createShellMaterial());
        orbGroup.add(orbMesh);

        // Inner ocean waves — horizontal planes at different Y levels
        const waveConfigs = [
            { y: 0.15, color: '#6366f1', phase: 0, amplitude: 0.08 },           // Upper wave - indigo
            { y: 0.0, color: '#8b5cf6', phase: Math.PI / 3, amplitude: 0.1 },   // Middle wave - purple
            { y: -0.15, color: '#a855f7', phase: Math.PI / 2, amplitude: 0.07 }, // Lower wave - violet
        ];

        waveMeshes = [];
        waveConfigs.forEach((cfg) => {
            // Create a circular disc that fits inside the sphere
            const geo = new THREE.CircleGeometry(0.55, 64);
            geo.rotateX(-Math.PI / 2);  // Make it horizontal

            const mat = CrownMaterials.createWaveMaterial(cfg.color);
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.y = cfg.y;
            mesh.userData = {
                baseY: cfg.y,
                phase: cfg.phase,
                amplitude: cfg.amplitude,
                basePositions: new Float32Array(geo.attributes.position.array)
            };
            waveMeshes.push(mesh);
            orbGroup.add(mesh);
        });

        orbGroup.position.y = 0;
        scene.add(orbGroup);
    }

    function morphOrb(elapsed, morphIntensity) {
        if (!orbMesh || !basePositions || reducedMotion) return;

        const posAttr = orbMesh.geometry.attributes.position;
        const normalAttr = orbMesh.geometry.attributes.normal;

        for (let i = 0; i < posAttr.count; i++) {
            const i3 = i * 3;

            // Original position
            const ox = basePositions[i3];
            const oy = basePositions[i3 + 1];
            const oz = basePositions[i3 + 2];

            // Original normal (outward direction)
            const nx = baseNormals[i3];
            const ny = baseNormals[i3 + 1];
            const nz = baseNormals[i3 + 2];

            // Lower frequency noise for smooth liquid undulation (not spiky)
            const n1 = noise3D(ox * 0.8 + elapsed * 0.15, oy * 0.8, oz * 0.8 + elapsed * 0.1);
            const n2 = noise3D(ox * 1.5 + elapsed * 0.25, oy * 1.5 + elapsed * 0.05, oz * 1.5) * 0.3;

            let displacement = (n1 + n2) * morphIntensity * 0.4; // gentler for near-perfect sphere

            // NOTE: Bubble bulge removed — replaced with physics-based drag-to-spin

            // Apply displacement along normal
            posAttr.array[i3] = ox + nx * displacement;
            posAttr.array[i3 + 1] = oy + ny * displacement;
            posAttr.array[i3 + 2] = oz + nz * displacement;
        }

        posAttr.needsUpdate = true;
        orbMesh.geometry.computeVertexNormals();
    }

    function createEnvironment() {
        const pmrem = new THREE.PMREMGenerator(renderer);

        const envScene = new THREE.Scene();
        envScene.background = new THREE.Color(isDarkTheme ? '#1e1b4b' : '#f0f4ff');

        // Softer, more diffuse lights for dreamy glass marble look
        const envLight1 = new THREE.PointLight(0x6366f1, 2, 50); // Indigo
        envLight1.position.set(5, 5, 5);
        envScene.add(envLight1);

        const envLight2 = new THREE.PointLight(0x8b5cf6, 1.5, 50); // Purple
        envLight2.position.set(-5, 3, -5);
        envScene.add(envLight2);

        const envLight3 = new THREE.PointLight(0xa78bfa, 1, 50); // Light purple
        envLight3.position.set(0, -3, 5);
        envScene.add(envLight3);

        const envTexture = pmrem.fromScene(envScene, 0.1).texture; // More blur
        scene.environment = envTexture;

        pmrem.dispose();
    }

    async function setupPostProcessing() {
        // Skip post-processing on low-end devices
        if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) {
            composer = null;
            return;
        }

        try {
            const { EffectComposer } = await import('three/addons/postprocessing/EffectComposer.js');
            const { RenderPass } = await import('three/addons/postprocessing/RenderPass.js');
            const { UnrealBloomPass } = await import('three/addons/postprocessing/UnrealBloomPass.js');

            composer = new EffectComposer(renderer);
            composer.addPass(new RenderPass(scene, camera));

            const bloomPass = new UnrealBloomPass(
                new THREE.Vector2(canvas.clientWidth, canvas.clientHeight),
                0.4,    // strength — much softer (was 1.8)
                0.6,    // radius — tighter (was 1.2)
                0.92    // threshold — only bloom brightest parts (was 0.5)
            );
            composer.addPass(bloomPass);
        } catch (e) {
            console.warn('Post-processing not available:', e);
            composer = null;
        }
    }

    function renderFrame() {
        if (composer) {
            composer.render();
        } else {
            renderer.render(scene, camera);
        }
    }

    function animate() {
        if (!isInitialized) return;

        const delta = clock.getDelta();
        const elapsed = clock.getElapsedTime();

        // Contentment mode — slower animations when idle for 10+ seconds
        const idleTime = elapsed - lastInteractionTime;
        isContentMode = idleTime > 10;
        const timeScale = isContentMode ? 0.5 : 1.0;
        const adjustedElapsed = elapsed * timeScale;

        // Calculate morph intensity — nearly perfect sphere with subtle organic shifts
        let morphIntensity = 0.015; // idle — barely visible movement

        if (crownState === 'analyzing') {
            // Subtle "talking" animation
            const talkPulse = Math.sin(elapsed * 10) * 0.5 + 0.5;
            const breathPulse = Math.sin(elapsed * 2) * 0.3 + 0.7;
            morphIntensity = 0.025 * breathPulse + 0.015 * talkPulse;
        } else if (crownState === 'autonomous') {
            morphIntensity = 0.02 + Math.sin(elapsed * 1.5) * 0.005;
        } else if (crownState === 'pulsing') {
            morphIntensity = 0.03;
        }

        // Apply morphing to outer shell
        morphOrb(adjustedElapsed, morphIntensity);

        // ===== AGI ALIVE BEHAVIORS =====

        // 1. Organic breathing — not perfectly regular
        const breathBase = Math.sin(adjustedElapsed * 0.8);
        const breathVariation = noise3D(adjustedElapsed * 0.1, 0, 0) * 0.3;
        const breathScale = 1 + (breathBase + breathVariation) * 0.02;

        // 2. Eye tracking — orb subtly orients toward cursor
        let lookTiltX = 0;
        if (orbGroup && mouseWorldPos) {
            const lookY = mouseWorldPos.y * 0.1;
            lookTiltX = lookY;
        }

        // 3. Curiosity — lean toward mouse when close
        let curiousLeanX = 0;
        if (mouseWorldPos) {
            const distToCenter = Math.sqrt(mouseWorldPos.x ** 2 + mouseWorldPos.y ** 2);
            if (distToCenter < 1.5 && distToCenter > 0.1) {
                curiousLeanX = mouseWorldPos.x * (1.5 - distToCenter) * 0.03;
            }
        }

        // 4. Startle response — detect rapid mouse movement
        mouseVelocity.x = mouseX - lastMousePos.x;
        mouseVelocity.y = mouseY - lastMousePos.y;
        const speed = Math.sqrt(mouseVelocity.x ** 2 + mouseVelocity.y ** 2);
        if (speed > 0.15 && elapsed - lastInteractionTime > 0.3) {
            // Quick movement detected — brief startle
            pulseOnce();
            lastInteractionTime = elapsed;
        }
        lastMousePos.x = mouseX;
        lastMousePos.y = mouseY;

        // Orb animations — combine all behaviors
        if (orbGroup) {
            // Check if user is spinning the orb manually
            const hasManualSpin = Math.abs(orbAngularVelocity.x) > ORB_INERTIA_THRESHOLD ||
                                  Math.abs(orbAngularVelocity.y) > ORB_INERTIA_THRESHOLD;

            if (hasManualSpin) {
                // Apply momentum from drag
                orbGroup.rotation.y += orbAngularVelocity.y;
                orbGroup.rotation.x += orbAngularVelocity.x;

                // Apply friction (slows down over time)
                orbAngularVelocity.x *= ORB_FRICTION;
                orbAngularVelocity.y *= ORB_FRICTION;

                // Clamp X rotation to prevent flipping
                orbGroup.rotation.x = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, orbGroup.rotation.x));
            } else {
                // Auto-rotation when not spinning manually
                const rotSpeed = crownState === 'analyzing' ? 0.004 :
                                 crownState === 'autonomous' ? 0.003 : 0.002;
                orbGroup.rotation.y += rotSpeed * timeScale;

                // Eye tracking (smooth follow) — only when not manually spinning
                orbGroup.rotation.x += (lookTiltX - orbGroup.rotation.x) * 0.02;
            }

            // Bouncy, organic float (combination of sine waves)
            const bounce1 = Math.sin(adjustedElapsed * 0.8) * 0.06;
            const bounce2 = Math.sin(adjustedElapsed * 1.6) * 0.02;
            const bounce3 = Math.sin(adjustedElapsed * 0.5) * 0.03;
            orbBaseY = bounce1 + bounce2 + bounce3;
            orbGroup.position.y = orbBaseY;

            // Curiosity lean (smooth)
            orbGroup.position.x += (curiousLeanX - orbGroup.position.x) * 0.02;

            // Apply breathing scale (when not analyzing)
            if (crownState !== 'analyzing') {
                orbGroup.scale.setScalar(breathScale);
            }
        }

        // Animate ocean waves — horizontal undulation
        waveMeshes.forEach((mesh) => {
            const { baseY, phase, amplitude, basePositions } = mesh.userData;

            // Gentle vertical bob for the whole wave plane
            mesh.position.y = baseY + Math.sin(adjustedElapsed * 0.5 + phase) * 0.02;

            // Apply wave displacement to vertices
            if (!reducedMotion) {
                const posAttr = mesh.geometry.attributes.position;
                for (let j = 0; j < posAttr.count; j++) {
                    const j3 = j * 3;
                    const ox = basePositions[j3];
                    const oz = basePositions[j3 + 2];

                    // Ocean wave: sin waves traveling across X and Z
                    const wave1 = Math.sin(ox * 4 + adjustedElapsed * 1.5 + phase) * amplitude;
                    const wave2 = Math.sin(oz * 3 + adjustedElapsed * 1.2 + phase * 0.7) * amplitude * 0.5;

                    posAttr.array[j3 + 1] = basePositions[j3 + 1] + wave1 + wave2;
                }
                posAttr.needsUpdate = true;
                mesh.geometry.computeVertexNormals();
            }
        });

        // Galaxy rotation with easing
        if (galaxyGroup) {
            galaxyGroup.rotation.x += (galaxyRotation.x - galaxyGroup.rotation.x) * 0.05;
            galaxyGroup.rotation.y += (galaxyRotation.y - galaxyGroup.rotation.y) * 0.05;

            // Subtle auto-rotation when not dragging
            if (!isDragging) {
                galaxyRotation.y += 0.0003 * timeScale;
            }
        }

        // Smooth glow interpolation
        if (pulseDecay > 0) {
            pulseDecay -= delta;
            if (pulseDecay <= 0) {
                pulseDecay = 0;
                targetGlowIntensity = 1.0;
            }
        }
        glowIntensity += (targetGlowIntensity - glowIntensity) * 0.05;

        // Camera sway (subtle mouse follow)
        const targetCamX = cameraBaseX + mouseX * 0.2;
        const targetCamY = cameraBaseY + mouseY * 0.15;
        camera.position.x += (targetCamX - camera.position.x) * 0.03;
        camera.position.y += (targetCamY - camera.position.y) * 0.03;
        camera.lookAt(0, 0, 0);

        // Update materials
        CrownMaterials.update(adjustedElapsed, glowIntensity, crownState);

        // Render
        renderFrame();

        animationId = requestAnimationFrame(animate);
    }

    function handleResize() {
        if (!canvas || !renderer) return;

        const container = canvas.parentElement;
        const width = container.clientWidth;
        const height = container.clientHeight;

        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);

        if (composer) {
            composer.setSize(width, height);
        }
    }

    function handleMouseMove(e) {
        const rect = canvas.getBoundingClientRect();
        mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouseY = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        // Update mouse position for morph interaction
        mouseNDC.x = mouseX;
        mouseNDC.y = mouseY;

        // Raycast to find intersection point on sphere
        if (orbMesh && raycaster && camera) {
            raycaster.setFromCamera(mouseNDC, camera);
            const intersects = raycaster.intersectObject(orbMesh);
            if (intersects.length > 0) {
                mouseWorldPos.copy(intersects[0].point);
            }
        }

        // Orb drag rotation (physics-based spin)
        if (orbDragging && orbGroup) {
            const dx = e.clientX - orbDragStart.x;
            const dy = e.clientY - orbDragStart.y;

            // Convert drag to angular velocity
            orbAngularVelocity.y = Math.max(-ORB_MAX_VELOCITY,
                                    Math.min(ORB_MAX_VELOCITY, dx * ORB_DRAG_SENSITIVITY));
            orbAngularVelocity.x = Math.max(-ORB_MAX_VELOCITY,
                                    Math.min(ORB_MAX_VELOCITY, dy * ORB_DRAG_SENSITIVITY * 0.5));

            orbDragStart.x = e.clientX;
            orbDragStart.y = e.clientY;
        }

        // Galaxy drag rotation (only if not dragging orb)
        if (isDragging && !orbDragging && galaxyGroup) {
            const dx = e.clientX - dragStart.x;
            const dy = e.clientY - dragStart.y;

            galaxyRotation.y += dx * 0.002;
            galaxyRotation.x += dy * 0.002;

            // Clamp vertical rotation
            galaxyRotation.x = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, galaxyRotation.x));

            dragStart.x = e.clientX;
            dragStart.y = e.clientY;
        }
    }

    function handleMouseDown(e) {
        const rect = canvas.getBoundingClientRect();
        const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const my = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        // Check if clicking on the orb
        mouseNDC.x = mx;
        mouseNDC.y = my;
        raycaster.setFromCamera(mouseNDC, camera);
        const intersects = raycaster.intersectObject(orbMesh);

        if (intersects.length > 0) {
            // Clicking on orb — drag to spin
            orbDragging = true;
            orbDragStart.x = e.clientX;
            orbDragStart.y = e.clientY;
        } else {
            // Clicking on background — drag galaxy
            isDragging = true;
            dragStart.x = e.clientX;
            dragStart.y = e.clientY;
        }

        canvas.style.cursor = 'grabbing';
        if (clock) lastInteractionTime = clock.getElapsedTime();
    }

    function handleMouseUp() {
        orbDragging = false;
        isDragging = false;
        canvas.style.cursor = 'grab';
    }

    function handleMouseLeave() {
        // Move mouse influence far away when cursor leaves
        mouseWorldPos.set(0, 0, 10);
        orbDragging = false;
        isDragging = false;
        canvas.style.cursor = 'grab';

        // AGI behavior: slight dim when alone
        targetGlowIntensity = 0.9;
    }

    function handleMouseEnter() {
        // AGI behavior: perk up when user returns
        targetGlowIntensity = 1.15;
        if (clock) lastInteractionTime = clock.getElapsedTime();
    }

    function handleClick() {
        // AGI behavior: acknowledge clicks with a pulse
        pulseOnce();
        if (clock) lastInteractionTime = clock.getElapsedTime();
    }

    function handleVisibility() {
        if (document.hidden) {
            // Pause
            if (animationId) {
                cancelAnimationFrame(animationId);
                animationId = null;
            }
        } else if (isInitialized && !reducedMotion && !animationId) {
            // Resume
            clock.getDelta(); // Reset delta to avoid jump
            animate();
        }
    }

    function destroy() {
        isInitialized = false;

        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }

        window.removeEventListener('resize', handleResize);
        document.removeEventListener('visibilitychange', handleVisibility);
        if (canvas) {
            canvas.removeEventListener('mousemove', handleMouseMove);
            canvas.removeEventListener('mouseleave', handleMouseLeave);
            canvas.removeEventListener('mousedown', handleMouseDown);
            canvas.removeEventListener('mouseup', handleMouseUp);
            canvas.removeEventListener('mouseenter', handleMouseEnter);
            canvas.removeEventListener('click', handleClick);
        }

        CrownMaterials.dispose();

        // Clean up orb group
        if (orbGroup) {
            orbGroup.traverse(child => {
                if (child.geometry) child.geometry.dispose();
            });
            scene.remove(orbGroup);
            orbGroup = null;
        }

        // Clean up galaxy
        if (galaxyGroup) {
            galaxyGroup.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            scene.remove(galaxyGroup);
            galaxyGroup = null;
            starField = null;
        }

        // Reset swirl meshes
        swirlMeshes = [];

        if (composer) {
            composer.dispose();
            composer = null;
        }

        if (renderer) {
            renderer.dispose();
            renderer = null;
        }

        scene = null;
        camera = null;
        basePositions = null;
        baseNormals = null;
    }

    // Public API
    function setState(newState) {
        crownState = newState;
    }

    function setGlow(intensity) {
        targetGlowIntensity = intensity;
    }

    function pulseOnce() {
        targetGlowIntensity = 1.5;
        pulseDecay = 2.0; // Decay back to 1.0 over 2 seconds
    }

    function setTheme(dark) {
        isDarkTheme = dark;
        if (isInitialized && renderer) {
            createEnvironment();
        }
        // Adjust star visibility based on theme
        if (starField && starField.material) {
            starField.material.opacity = dark ? 0.8 : 0.15;
        }
    }

    function getScene() {
        return scene;
    }

    return {
        init,
        destroy,
        setState,
        setGlow,
        pulseOnce,
        setTheme,
        getScene,
    };
})();

window.CrownScene = CrownScene;
