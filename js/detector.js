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
        
        // Detection thresholds - balanced for accuracy
        this.thresholds = {
            1: { fire: 0.45, smoke: 0.65, minPixels: 0.015 }, // Low - strict
            2: { fire: 0.35, smoke: 0.55, minPixels: 0.010 }, // Medium - balanced
            3: { fire: 0.25, smoke: 0.45, minPixels: 0.006 }  // High - sensitive
        };
        
        // Consecutive frames to confirm detection
        this.consecutiveFramesRequired = 4;
        this.consecutiveFireFrames = 0;
        this.consecutiveSmokeFrames = 0;

        // Fire color ranges - exclude skin/furniture but detect real flames
        this.fireColors = {
            hueMin: 0,
            hueMax: 40,        // Red to orange
            satMin: 65,        // Flames are vivid (skin is ~40-55%)
            lightMin: 45,
            lightMax: 98
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

        // Calculate confidence
        let fireConfidence = fireRatio >= 0.02 ? Math.min(1, fireRatio * 7) : 0;
        let smokeConfidence = smokeRatio >= 0.05 ? Math.min(1, smokeRatio * 5) : 0;
        
        // Flickering bonus/penalty for fire
        const flickerBonus = this.calculateFlickerBonus();
        if (flickerBonus < 0.15) {
            fireConfidence *= 0.5; // Reduce by 50% if no flickering (static object)
        } else if (flickerBonus > 0.35) {
            fireConfidence = Math.min(1, fireConfidence * 1.4); // Boost for strong flicker
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
     * Detects real flames while excluding skin tones and furniture
     */
    isFireColor(h, s, l, r, g, b) {
        // Fire must be in red-orange hue range
        const isFireHue = (h >= this.fireColors.hueMin && h <= this.fireColors.hueMax) ||
                          (h >= 350); // Wrap-around red
        
        // Good saturation (flames are vivid, skin/wood is muted)
        const hasFireSaturation = s >= this.fireColors.satMin;
        const hasFireLightness = l >= this.fireColors.lightMin && l <= this.fireColors.lightMax;
        
        // Red must be dominant
        const isRedDominant = r > g && r > b;
        
        // Red-Green difference: flames have R much higher than G
        // Skin: R-G = 10-30, Flames: R-G = 40-100+
        const redGreenDiff = r - g;
        const isTrueFlame = redGreenDiff > 40;
        
        // Blue should be relatively low (flames have little blue)
        const hasLowBlue = b < 120;
        
        // Require bright red channel
        const hasBrightRed = r > 170;
        
        // EXCLUDE skin tones explicitly
        // Skin RGB pattern: R:170-240, G:120-200, B:100-170 with small R-G diff
        const isSkinTone = (r > 160 && r < 245 && 
                           g > 110 && g < 210 && 
                           b > 85 && b < 180 && 
                           redGreenDiff < 50);
        
        // All conditions except skin exclusion
        return isFireHue && hasFireSaturation && hasFireLightness && 
               isRedDominant && isTrueFlame && hasLowBlue && 
               hasBrightRed && !isSkinTone;
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
