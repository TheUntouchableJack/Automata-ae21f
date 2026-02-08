// ===== Neural Orb Particles Module =====
// Neural-network-style particle nodes orbiting the 3D sphere

const CrownParticles = (function() {
    let THREE = null;
    let particleSystem = null;
    let connectionLines = null;
    let scene = null;
    let positions, velocities, colors, sizes;

    const CONFIG = {
        count: 120,
        orbitRadius: 1.4,
        connectionDistance: 0.9,
        baseSpeed: 0.12,
        colors: {
            purple: [0.66, 0.33, 0.97],   // #a855f7
            cyan:   [0.02, 0.71, 0.83],    // #06b6d4
            white:  [0.9, 0.9, 1.0],
        }
    };

    function setTHREE(threeLib) {
        THREE = threeLib;
    }

    function init(targetScene) {
        scene = targetScene;
        createParticles();
        createConnections();
    }

    function createParticles() {
        const geometry = new THREE.BufferGeometry();
        positions = new Float32Array(CONFIG.count * 3);
        velocities = new Float32Array(CONFIG.count * 3);
        colors = new Float32Array(CONFIG.count * 3);
        sizes = new Float32Array(CONFIG.count);

        const colorPalette = [CONFIG.colors.purple, CONFIG.colors.cyan, CONFIG.colors.white];

        for (let i = 0; i < CONFIG.count; i++) {
            const i3 = i * 3;

            // Distribute on a sphere
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const r = CONFIG.orbitRadius * (0.8 + Math.random() * 0.5);

            positions[i3]     = r * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.8;
            positions[i3 + 2] = r * Math.cos(phi);

            // Random orbital velocities
            velocities[i3]     = (Math.random() - 0.5) * CONFIG.baseSpeed;
            velocities[i3 + 1] = (Math.random() - 0.5) * CONFIG.baseSpeed * 0.5;
            velocities[i3 + 2] = (Math.random() - 0.5) * CONFIG.baseSpeed;

            // Random color from palette
            const c = colorPalette[Math.floor(Math.random() * colorPalette.length)];
            colors[i3]     = c[0];
            colors[i3 + 1] = c[1];
            colors[i3 + 2] = c[2];

            // Random size
            sizes[i] = 2.0 + Math.random() * 3.0;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.PointsMaterial({
            size: 0.04,
            vertexColors: true,
            transparent: true,
            opacity: 0.7,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true,
        });

        particleSystem = new THREE.Points(geometry, material);
        scene.add(particleSystem);
    }

    function createConnections() {
        // Pre-allocate connection line geometry (max connections)
        const maxConnections = CONFIG.count * 3; // rough upper bound
        const linePositions = new Float32Array(maxConnections * 6); // 2 points per line, 3 coords each
        const lineColors = new Float32Array(maxConnections * 6);

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));
        geometry.setDrawRange(0, 0); // Start with no lines

        const material = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.25,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        connectionLines = new THREE.LineSegments(geometry, material);
        scene.add(connectionLines);
    }

    function update(delta, elapsed, state) {
        if (!particleSystem) return;

        const pos = particleSystem.geometry.attributes.position.array;
        const speedMult = state === 'autonomous' ? 1.8 : state === 'analyzing' ? 2.5 : 1.0;

        for (let i = 0; i < CONFIG.count; i++) {
            const i3 = i * 3;

            // Apply velocity
            pos[i3]     += velocities[i3]     * delta * speedMult;
            pos[i3 + 1] += velocities[i3 + 1] * delta * speedMult;
            pos[i3 + 2] += velocities[i3 + 2] * delta * speedMult;

            // Keep particles within orbit radius (soft constraint)
            const dx = pos[i3], dy = pos[i3 + 1], dz = pos[i3 + 2];
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const maxR = CONFIG.orbitRadius * 1.3;
            const minR = Math.max(CONFIG.orbitRadius * 0.5, 0.85);

            if (dist > maxR) {
                // Pull back toward center
                const factor = 0.02;
                pos[i3]     -= dx * factor;
                pos[i3 + 1] -= dy * factor;
                pos[i3 + 2] -= dz * factor;
            } else if (dist < minR) {
                // Push away from center (prevents entering sphere)
                const factor = 0.03;
                pos[i3]     += (dx / dist) * factor;
                pos[i3 + 1] += (dy / dist) * factor;
                pos[i3 + 2] += (dz / dist) * factor;
            }

            // Analyzing state: particles drift toward center briefly
            if (state === 'analyzing') {
                const convergeFactor = Math.sin(elapsed * 2) * 0.005;
                pos[i3]     -= dx * convergeFactor;
                pos[i3 + 1] -= dy * convergeFactor;
                pos[i3 + 2] -= dz * convergeFactor;
            }
        }

        particleSystem.geometry.attributes.position.needsUpdate = true;

        // Update connections
        updateConnections(state);
    }

    function updateConnections(state) {
        if (!connectionLines) return;

        const pos = particleSystem.geometry.attributes.position.array;
        const linePos = connectionLines.geometry.attributes.position.array;
        const lineCol = connectionLines.geometry.attributes.color.array;
        const maxDist = state === 'autonomous' ? CONFIG.connectionDistance * 1.3 : CONFIG.connectionDistance;
        let lineCount = 0;
        const maxLines = linePos.length / 6;

        // Only check every other particle for performance
        const step = state === 'idle' ? 3 : 2;

        for (let i = 0; i < CONFIG.count && lineCount < maxLines; i += step) {
            const i3 = i * 3;
            for (let j = i + 1; j < CONFIG.count && lineCount < maxLines; j += step) {
                const j3 = j * 3;
                const dx = pos[i3] - pos[j3];
                const dy = pos[i3 + 1] - pos[j3 + 1];
                const dz = pos[i3 + 2] - pos[j3 + 2];
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

                if (dist < maxDist) {
                    const idx = lineCount * 6;
                    const alpha = 1.0 - (dist / maxDist);

                    // Start point
                    linePos[idx]     = pos[i3];
                    linePos[idx + 1] = pos[i3 + 1];
                    linePos[idx + 2] = pos[i3 + 2];
                    // End point
                    linePos[idx + 3] = pos[j3];
                    linePos[idx + 4] = pos[j3 + 1];
                    linePos[idx + 5] = pos[j3 + 2];

                    // Connection color (purple-ish, fading with distance)
                    const r = 0.5 * alpha, g = 0.3 * alpha, b = 0.9 * alpha;
                    lineCol[idx]     = r; lineCol[idx + 1] = g; lineCol[idx + 2] = b;
                    lineCol[idx + 3] = r; lineCol[idx + 4] = g; lineCol[idx + 5] = b;

                    lineCount++;
                }
            }
        }

        connectionLines.geometry.setDrawRange(0, lineCount * 2);
        connectionLines.geometry.attributes.position.needsUpdate = true;
        connectionLines.geometry.attributes.color.needsUpdate = true;
    }

    function destroy() {
        if (particleSystem) {
            particleSystem.geometry.dispose();
            particleSystem.material.dispose();
            scene.remove(particleSystem);
            particleSystem = null;
        }
        if (connectionLines) {
            connectionLines.geometry.dispose();
            connectionLines.material.dispose();
            scene.remove(connectionLines);
            connectionLines = null;
        }
    }

    return { setTHREE, init, update, destroy };
})();

window.CrownParticles = CrownParticles;
