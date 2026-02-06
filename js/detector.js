/**
 * Fire & Smoke Detector Module
 * Uses color analysis and pattern recognition for detection
 */
class FireDetector {
    constructor() {
        this.canvas = document.getElementById('detectionCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.isRunning = false;
        this.sensitivity = 2; // 1=Low, 2=Medium, 3=High
        this.lastDetection = null;
        this.frameHistory = [];
        this.maxHistoryFrames = 5;
        
        // Detection thresholds based on sensitivity - BALANCED for real flames
        this.thresholds = {
            1: { fire: 0.40, smoke: 0.60, minPixels: 0.012 }, // Low - strict
            2: { fire: 0.30, smoke: 0.50, minPixels: 0.008 }, // Medium - balanced
            3: { fire: 0.20, smoke: 0.40, minPixels: 0.005 }  // High - sensitive
        };
        
        // Consecutive frame requirement for detection
        this.consecutiveFramesRequired = 3;
        this.consecutiveFireFrames = 0;
        this.consecutiveSmokeFrames = 0;

        // Fire color ranges in HSL - BALANCED to detect flames but exclude yellow objects
        this.fireColors = {
            // Red-orange flames (excludes pure yellow which is ~60°)
            hueMin: 0,
            hueMax: 45,       // Allows orange but not pure yellow
            satMin: 55,       // Flames are saturated
            lightMin: 40,
            lightMax: 95
        };

        // Smoke color characteristics - MUCH stricter
        this.smokeColors = {
            satMax: 12,      // Very low saturation (almost pure gray)
            lightMin: 45,    // Not too dark
            lightMax: 70,    // Not too bright (exclude white walls)
            // Smoke typically has slight blue/gray tint
            hueMin: 180,
            hueMax: 260
        };

        // Callbacks
        this.onDetection = null;
        this.onConfidenceUpdate = null;
    }

    /**
     * Set detection sensitivity
     * @param {number} level - 1 (Low), 2 (Medium), 3 (High)
     */
    setSensitivity(level) {
        this.sensitivity = Math.max(1, Math.min(3, level));
    }

    /**
     * Start detection loop
     * @param {CameraManager} camera
     */
    start(camera) {
        this.isRunning = true;
        this.camera = camera;
        this.frameHistory = [];
        this.detect();
    }

    /**
     * Stop detection loop
     */
    stop() {
        this.isRunning = false;
        this.frameHistory = [];
        this.clearOverlay();
    }

    /**
     * Main detection loop
     */
    detect() {
        if (!this.isRunning) return;

        const imageData = this.camera.getFrame(this.canvas);
        
        if (imageData) {
            const result = this.analyzeFrame(imageData);
            
            // Update confidence callback
            if (this.onConfidenceUpdate) {
                this.onConfidenceUpdate(result);
            }

            // Check for detection with consecutive frame requirement
            const threshold = this.thresholds[this.sensitivity];
            
            // Fire detection - require multiple consecutive frames
            if (result.fireConfidence >= threshold.fire && result.firePixelRatio >= threshold.minPixels) {
                this.consecutiveFireFrames++;
                if (this.consecutiveFireFrames >= this.consecutiveFramesRequired) {
                    this.handleDetection(result, 'fire');
                }
            } else {
                this.consecutiveFireFrames = Math.max(0, this.consecutiveFireFrames - 1);
            }
            
            // Smoke detection - require more consecutive frames AND motion
            if (result.smokeConfidence >= threshold.smoke && 
                result.smokePixelRatio >= threshold.minPixels &&
                this.detectMotion()) {
                this.consecutiveSmokeFrames++;
                if (this.consecutiveSmokeFrames >= this.consecutiveFramesRequired + 2) {
                    this.handleDetection(result, 'smoke');
                }
            } else {
                this.consecutiveSmokeFrames = Math.max(0, this.consecutiveSmokeFrames - 1);
            }

            // Draw detection overlay
            this.drawOverlay(result);
        }

        // Continue loop at ~15 FPS
        requestAnimationFrame(() => {
            setTimeout(() => this.detect(), 66);
        });
    }

    /**
     * Analyze a single frame for fire and smoke
     * @param {ImageData} imageData
     * @returns {Object} Detection results
     */
    analyzeFrame(imageData) {
        const data = imageData.data;
        const totalPixels = imageData.width * imageData.height;
        
        let firePixels = 0;
        let smokePixels = 0;
        let fireIntensity = 0;
        let smokeIntensity = 0;
        
        const fireRegions = [];
        const smokeRegions = [];

        // Sample every 4th pixel for performance
        for (let i = 0; i < data.length; i += 16) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            
            const { h, s, l } = this.rgbToHsl(r, g, b);
            
            // Check for fire colors
            if (this.isFireColor(h, s, l, r, g, b)) {
                firePixels++;
                fireIntensity += l;
                
                // Store region info
                const pixelIndex = i / 4;
                const x = (pixelIndex % imageData.width) * 4;
                const y = Math.floor(pixelIndex / imageData.width) * 4;
                fireRegions.push({ x, y, intensity: l });
            }
            
            // Check for smoke colors
            if (this.isSmokeColor(h, s, l)) {
                smokePixels++;
                smokeIntensity += (100 - s);
                
                const pixelIndex = i / 4;
                const x = (pixelIndex % imageData.width) * 4;
                const y = Math.floor(pixelIndex / imageData.width) * 4;
                smokeRegions.push({ x, y, intensity: l });
            }
        }

        const sampledPixels = totalPixels / 4;
        const fireRatio = firePixels / sampledPixels;
        const smokeRatio = smokePixels / sampledPixels;
        
        // Calculate confidence based on pixel ratio - require significant coverage
        // Fire needs at least 2% of frame to be flame-colored
        let fireConfidence = fireRatio >= 0.02 ? Math.min(1, fireRatio * 8) : 0;
        // Smoke needs at least 5% of frame and motion to avoid static gray objects
        let smokeConfidence = smokeRatio >= 0.05 ? Math.min(1, smokeRatio * 5) : 0;
        
        // Apply flickering bonus for fire (check frame history)
        const flickerBonus = this.calculateFlickerBonus();
        if (flickerBonus > 0.3) {
            fireConfidence = Math.min(1, fireConfidence * (1 + flickerBonus * 0.5));
        }
        
        // Store frame for history
        this.frameHistory.push({ fireRatio, smokeRatio, timestamp: Date.now() });
        if (this.frameHistory.length > this.maxHistoryFrames) {
            this.frameHistory.shift();
        }

        return {
            fireConfidence,
            smokeConfidence,
            fireRegions: this.clusterRegions(fireRegions),
            smokeRegions: this.clusterRegions(smokeRegions),
            firePixelRatio: fireRatio,
            smokePixelRatio: smokeRatio
        };
    }

    /**
     * Check if pixel color matches fire characteristics
     * BALANCED: Detects real flames but excludes pure yellow objects
     */
    isFireColor(h, s, l, r, g, b) {
        // Fire must be in red-orange hue range (NOT pure yellow at 60°)
        const isFireHue = (h >= this.fireColors.hueMin && h <= this.fireColors.hueMax) ||
                          (h >= 350); // Wrap-around red
        
        const hasFireSaturation = s >= this.fireColors.satMin;
        const hasFireLightness = l >= this.fireColors.lightMin && l <= this.fireColors.lightMax;
        
        // Red must be dominant - but allow some orange (where green is present)
        const isRedDominant = r > g && r > b;
        
        // Exclude pure yellow: yellow has R ≈ G, flames have R > G
        // Allow orange flames where green is up to 85% of red
        const redGreenRatio = r > 0 ? g / r : 1;
        const notPureYellow = redGreenRatio < 0.85; // Yellow objects have ratio close to 1.0
        
        // Require reasonable red intensity (not too dark)
        const hasRedIntensity = r > 120;
        
        // All conditions must be met
        return isFireHue && hasFireSaturation && hasFireLightness && 
               isRedDominant && notPureYellow && hasRedIntensity;
    }

    /**
     * Check if pixel color matches smoke characteristics
     * Much stricter to avoid false positives from walls/furniture
     */
    isSmokeColor(h, s, l) {
        // Smoke must be very low saturation (almost gray)
        const hasVeryLowSaturation = s <= this.smokeColors.satMax;
        // Must be in correct lightness range (not pure white or dark)
        const hasSmokeLightness = l >= this.smokeColors.lightMin && l <= this.smokeColors.lightMax;
        // Smoke often has slight blue-gray tint OR is pure gray (s < 5)
        const hasSmokeHue = s < 5 || (h >= this.smokeColors.hueMin && h <= this.smokeColors.hueMax);
        
        return hasVeryLowSaturation && hasSmokeLightness && hasSmokeHue;
    }
    
    /**
     * Detect motion between frames to distinguish smoke from static gray objects
     */
    detectMotion() {
        if (this.frameHistory.length < 3) return false;
        
        let motionScore = 0;
        for (let i = 1; i < this.frameHistory.length; i++) {
            const diff = Math.abs(this.frameHistory[i].smokeRatio - this.frameHistory[i - 1].smokeRatio);
            if (diff > 0.005) motionScore++;
        }
        
        // Require movement in smoke regions (billowing effect)
        return motionScore >= 2;
    }

    /**
     * Convert RGB to HSL
     */
    rgbToHsl(r, g, b) {
        r /= 255;
        g /= 255;
        b /= 255;
        
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;

        if (max === min) {
            h = s = 0;
        } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            
            switch (max) {
                case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
                case g: h = ((b - r) / d + 2) / 6; break;
                case b: h = ((r - g) / d + 4) / 6; break;
            }
        }

        return { h: h * 360, s: s * 100, l: l * 100 };
    }

    /**
     * Calculate flicker bonus based on frame history
     */
    calculateFlickerBonus() {
        if (this.frameHistory.length < 3) return 0;
        
        let variations = 0;
        for (let i = 1; i < this.frameHistory.length; i++) {
            const diff = Math.abs(this.frameHistory[i].fireRatio - this.frameHistory[i - 1].fireRatio);
            if (diff > 0.01) variations++;
        }
        
        return variations / (this.frameHistory.length - 1);
    }

    /**
     * Cluster nearby regions for visualization
     */
    clusterRegions(regions) {
        if (regions.length === 0) return [];
        
        // Simple clustering - just return bounding boxes of detected areas
        const clusters = [];
        const gridSize = 50;
        const grid = {};
        
        regions.forEach(({ x, y }) => {
            const key = `${Math.floor(x / gridSize)}_${Math.floor(y / gridSize)}`;
            if (!grid[key]) {
                grid[key] = { count: 0, x: x, y: y };
            }
            grid[key].count++;
        });
        
        Object.values(grid).forEach(cell => {
            if (cell.count > 2) {
                clusters.push({
                    x: cell.x,
                    y: cell.y,
                    size: Math.min(80, cell.count * 5)
                });
            }
        });
        
        return clusters.slice(0, 10); // Limit to 10 clusters
    }

    /**
     * Handle detection event
     */
    handleDetection(result, type) {
        const now = Date.now();
        const confidence = type === 'fire' ? result.fireConfidence : result.smokeConfidence;
        
        // Debounce detections (min 5 seconds apart for same type)
        if (this.lastDetection && 
            this.lastDetection.type === type && 
            now - this.lastDetection.timestamp < 5000) {
            return;
        }
        
        this.lastDetection = {
            type,
            confidence,
            timestamp: now
        };
        
        // Reset consecutive counters after detection
        if (type === 'fire') {
            this.consecutiveFireFrames = 0;
        } else {
            this.consecutiveSmokeFrames = 0;
        }
        
        if (this.onDetection) {
            this.onDetection({
                type,
                confidence: Math.round(confidence * 100),
                timestamp: now
            });
        }
    }

    /**
     * Draw detection overlay on canvas
     */
    drawOverlay(result) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Draw fire regions
        result.fireRegions.forEach(region => {
            this.ctx.beginPath();
            this.ctx.arc(region.x, region.y, region.size, 0, Math.PI * 2);
            this.ctx.strokeStyle = 'rgba(255, 77, 0, 0.8)';
            this.ctx.lineWidth = 3;
            this.ctx.stroke();
            this.ctx.fillStyle = 'rgba(255, 77, 0, 0.2)';
            this.ctx.fill();
        });
        
        // Draw smoke regions
        result.smokeRegions.forEach(region => {
            this.ctx.beginPath();
            this.ctx.arc(region.x, region.y, region.size, 0, Math.PI * 2);
            this.ctx.strokeStyle = 'rgba(139, 157, 195, 0.8)';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
            this.ctx.fillStyle = 'rgba(139, 157, 195, 0.2)';
            this.ctx.fill();
        });
    }

    /**
     * Clear the detection overlay
     */
    clearOverlay() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
}

// Export for use in other modules
window.FireDetector = FireDetector;
