// ===== Fluid Orb Materials Module =====
// Iridescent oil-slick shell + emissive core with animated color shifts

const CrownMaterials = (function() {
    let THREE = null;
    let shellMaterials = [];
    let coreMaterials = [];
    let ribbonMaterials = [];
    let waveMaterials = [];  // Ocean wave materials (renamed from swirl)

    function setTHREE(threeLib) {
        THREE = threeLib;
    }

    // Outer shell — soft glass marble look (not oil-slick)
    function createShellMaterial() {
        const mat = new THREE.MeshPhysicalMaterial({
            color: new THREE.Color('#6b8cce'),      // Softer blue
            metalness: 0.0,                          // No metallic
            roughness: 0.05,                         // Slight softness
            transmission: 0.95,                      // Very transparent
            thickness: 3.0,                          // Thick glass
            ior: 1.45,                               // Glass-like refraction
            iridescence: 0.3,                        // Subtle iridescence
            iridescenceIOR: 1.3,
            iridescenceThicknessRange: [200, 400],   // Narrower = softer colors
            clearcoat: 0.5,                          // Reduced clearcoat
            clearcoatRoughness: 0.1,
            sheen: 0.2,                              // Subtle sheen
            sheenColor: new THREE.Color('#a78bfa'),  // Soft purple
            sheenRoughness: 0.3,
            emissive: new THREE.Color('#4f46e5'),    // Blue-purple emissive
            emissiveIntensity: 0.08,                 // Reduced glow (was 0.15)
            transparent: true,
            opacity: 0.7,                            // More transparent
            envMapIntensity: 2.0,
            side: THREE.DoubleSide,
            depthWrite: false,                       // Allow ribbon to show through
        });
        shellMaterials.push(mat);
        return mat;
    }

    // Inner energy core — softer blue glow center (kept for compatibility)
    function createCoreMaterial() {
        const mat = new THREE.MeshPhysicalMaterial({
            color: new THREE.Color('#818cf8'),
            emissive: new THREE.Color('#4f46e5'),
            emissiveIntensity: 0.6,   // Reduced from 1.2
            metalness: 0.0,
            roughness: 0.3,
            transmission: 0.0,
            clearcoat: 0.0,
            transparent: true,
            opacity: 0.9,
        });
        coreMaterials.push(mat);
        return mat;
    }

    // Inner flowing ribbon — soft, glowing, dreamy (legacy, kept for compatibility)
    function createRibbonMaterial() {
        const mat = new THREE.MeshPhysicalMaterial({
            color: new THREE.Color('#6366f1'),
            emissive: new THREE.Color('#4f46e5'),
            emissiveIntensity: 2.0,
            metalness: 0.0,
            roughness: 0.4,
            transparent: true,
            opacity: 0.85,
            side: THREE.DoubleSide,
        });
        ribbonMaterials.push(mat);
        return mat;
    }

    // Inner ocean wave layers — soft, transparent, horizontal planes
    function createWaveMaterial(colorHex) {
        const mat = new THREE.MeshPhysicalMaterial({
            color: new THREE.Color(colorHex),
            emissive: new THREE.Color(colorHex),
            emissiveIntensity: 0.3,   // Reduced from 0.8 - less blinding
            metalness: 0.0,
            roughness: 0.5,
            transparent: true,
            opacity: 0.4,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        waveMaterials.push(mat);
        return mat;
    }

    // Apply materials to a loaded GLTF model (future use)
    function applyToModel(model) {
        const shellMat = createShellMaterial();
        model.traverse((child) => {
            if (child.isMesh) {
                child.material = shellMat;
            }
        });
    }

    // Update materials — gentle dreamy animation
    function update(elapsed, glowIntensity, state) {
        // Shell: very slow, subtle color shifts
        shellMaterials.forEach(mat => {
            // Very slow iridescence shift
            mat.iridescenceIOR = 1.28 + Math.sin(elapsed * 0.2) * 0.04;

            // Gentle color drift in blue-purple range
            const hueShift = Math.sin(elapsed * 0.05) * 0.02;
            mat.color.setHSL(0.62 + hueShift, 0.35, 0.62); // Blue-ish

            // Soft sheen animation
            const sheenHue = 0.72 + Math.sin(elapsed * 0.08) * 0.03;
            mat.sheenColor.setHSL(sheenHue, 0.5, 0.7);

            // Soft emissive breathing
            let emissiveBase = 0.12 + Math.sin(elapsed * 0.8) * 0.03;
            if (state === 'analyzing') {
                emissiveBase = 0.18 + Math.sin(elapsed * 4) * 0.05;
            } else if (state === 'autonomous') {
                emissiveBase = 0.14 + Math.sin(elapsed * 1.5) * 0.03;
            }
            mat.emissiveIntensity = emissiveBase * glowIntensity;
        });

        // Core: softer glow, gentle breathing (reduced from original)
        coreMaterials.forEach(mat => {
            let targetEmissive = 0.5; // Reduced base (was 1.0)

            if (state === 'analyzing') {
                targetEmissive = 0.7 + Math.sin(elapsed * 6) * 0.15;
                const coreHue = 0.65 + Math.sin(elapsed * 2) * 0.03;
                mat.emissive.setHSL(coreHue, 0.6, 0.4);
            } else if (state === 'autonomous') {
                targetEmissive = 0.55 + Math.sin(elapsed * 2) * 0.1;
                mat.emissive.setHSL(0.65, 0.55, 0.4);
            } else if (state === 'pulsing') {
                targetEmissive = 0.8;
            } else {
                // Idle: gentle breath
                targetEmissive = 0.5 + Math.sin(elapsed * 0.8) * 0.1;
                mat.emissive.setHSL(0.65, 0.5, 0.4);
            }

            mat.emissiveIntensity = targetEmissive * glowIntensity;
        });

        // Ribbon: flowing gradient through blue/purple/pink (legacy)
        ribbonMaterials.forEach(mat => {
            const hue = 0.6 + Math.sin(elapsed * 0.3) * 0.12;
            mat.color.setHSL(hue, 0.65, 0.55);
            mat.emissive.setHSL(hue + 0.05, 0.75, 0.45);
            let ribbonEmissive = 0.7 + Math.sin(elapsed * 1.2) * 0.2;
            if (state === 'analyzing') {
                ribbonEmissive = 1.0 + Math.sin(elapsed * 4) * 0.3;
            }
            mat.emissiveIntensity = ribbonEmissive * glowIntensity;
        });

        // Wave layers: gentle color animation (reduced brightness)
        waveMaterials.forEach((mat, i) => {
            const hueOffset = i * 0.08;
            const hue = 0.6 + hueOffset + Math.sin(elapsed * 0.2 + i) * 0.04;
            mat.color.setHSL(hue, 0.5, 0.45);        // Less saturated
            mat.emissive.setHSL(hue, 0.6, 0.3);      // Darker emissive

            // Much gentler glow (reduced from 0.6 base)
            let waveEmissive = 0.25 + Math.sin(elapsed * 1.2 + i * 0.7) * 0.1;
            if (state === 'analyzing') {
                waveEmissive = 0.4 + Math.sin(elapsed * 3 + i) * 0.15;
            }
            mat.emissiveIntensity = waveEmissive * glowIntensity;
        });
    }

    // Cleanup
    function dispose() {
        shellMaterials.forEach(m => m.dispose());
        coreMaterials.forEach(m => m.dispose());
        ribbonMaterials.forEach(m => m.dispose());
        waveMaterials.forEach(m => m.dispose());
        shellMaterials = [];
        coreMaterials = [];
        ribbonMaterials = [];
        waveMaterials = [];
    }

    return {
        setTHREE,
        createShellMaterial,
        createCoreMaterial,
        createRibbonMaterial,
        createWaveMaterial,
        applyToModel,
        update,
        dispose
    };
})();

window.CrownMaterials = CrownMaterials;
