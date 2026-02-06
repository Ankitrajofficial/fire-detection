/**
 * Alerts Module - Handles audio and visual alerts
 */
class AlertManager {
    constructor() {
        this.alertFlash = document.getElementById('alertFlash');
        this.silenceBtn = document.getElementById('silenceBtn');
        
        // Audio context for alarm sound
        this.audioContext = null;
        this.oscillator = null;
        this.gainNode = null;
        this.isPlaying = false;
        this.isSilenced = false;
        
        // Settings
        this.soundEnabled = true;
        this.flashEnabled = true;
        
        // Alert state
        this.currentAlert = null;
        this.alertCooldown = 3000; // 3 seconds between alerts
        this.lastAlertTime = 0;
        
        // Auto-stop feature: stop alarm if fire not detected for 10 seconds
        this.autoStopTimeout = null;
        this.autoStopDelay = 10000; // 10 seconds
        this.lastFireDetectedTime = 0;
        this.onAutoStop = null; // Callback when auto-stopped
    }

    /**
     * Initialize Web Audio API
     */
    initAudio() {
        if (this.audioContext) return;
        
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            console.log('Audio context initialized');
        } catch (error) {
            console.error('Web Audio API not supported:', error);
        }
    }

    /**
     * Trigger an alert
     * @param {string} type - 'fire' or 'smoke'
     * @param {number} confidence - Detection confidence (0-100)
     */
    trigger(type, confidence) {
        const now = Date.now();
        
        // Check cooldown
        if (now - this.lastAlertTime < this.alertCooldown) {
            return false;
        }
        
        this.lastAlertTime = now;
        this.currentAlert = { type, confidence, timestamp: now };
        this.isSilenced = false;
        
        // Enable silence button
        this.silenceBtn.disabled = false;
        
        // Play audio alarm
        if (this.soundEnabled && !this.isSilenced) {
            this.startAlarm(type);
        }
        
        // Trigger visual flash
        if (this.flashEnabled) {
            this.flash();
        }
        
        return true;
    }

    /**
     * Start alarm sound using Web Audio API
     * Creates an aggressive beeping pattern
     */
    startAlarm(type = 'fire') {
        this.initAudio();
        
        if (!this.audioContext || this.isPlaying) return;
        
        try {
            // Resume audio context if suspended (required by browsers)
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }
            
            this.isPlaying = true;
            this.playBeepPattern(type);
        } catch (error) {
            console.error('Error starting alarm:', error);
        }
    }

    /**
     * Play a beeping pattern
     */
    playBeepPattern(type) {
        if (!this.isPlaying || this.isSilenced) return;
        
        const frequency = type === 'fire' ? 880 : 660; // Higher for fire
        const duration = type === 'fire' ? 200 : 300;
        const pause = type === 'fire' ? 100 : 200;
        
        this.playBeep(frequency, duration);
        
        // Schedule next beep
        setTimeout(() => {
            if (this.isPlaying && !this.isSilenced) {
                this.playBeepPattern(type);
            }
        }, duration + pause);
    }

    /**
     * Play a single beep
     */
    playBeep(frequency, duration) {
        if (!this.audioContext) return;
        
        try {
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
            
            oscillator.type = 'square';
            oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
            
            // Quick attack, sustain, quick release
            gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
            gainNode.gain.linearRampToValueAtTime(0.5, this.audioContext.currentTime + 0.01);
            gainNode.gain.linearRampToValueAtTime(0.5, this.audioContext.currentTime + (duration / 1000) - 0.01);
            gainNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + (duration / 1000));
            
            oscillator.start(this.audioContext.currentTime);
            oscillator.stop(this.audioContext.currentTime + (duration / 1000));
        } catch (error) {
            console.error('Error playing beep:', error);
        }
    }

    /**
     * Stop the alarm
     */
    stopAlarm() {
        this.isPlaying = false;
        this.isSilenced = true;
        this.currentAlert = null;
        this.silenceBtn.disabled = true;
        
        // Clear auto-stop timeout
        if (this.autoStopTimeout) {
            clearTimeout(this.autoStopTimeout);
            this.autoStopTimeout = null;
        }
    }

    /**
     * Silence the current alarm
     */
    silence() {
        this.isSilenced = true;
        this.isPlaying = false;
        this.silenceBtn.disabled = true;
        
        // Clear auto-stop timeout
        if (this.autoStopTimeout) {
            clearTimeout(this.autoStopTimeout);
            this.autoStopTimeout = null;
        }
        
        console.log('Alarm silenced');
    }
    
    /**
     * Update fire detection status - call this every frame
     * Auto-stops alarm if fire not detected for 10 seconds
     * @param {boolean} fireDetected - Whether fire is currently detected
     */
    updateFireStatus(fireDetected) {
        if (fireDetected) {
            // Fire detected - reset the auto-stop timer
            this.lastFireDetectedTime = Date.now();
            
            if (this.autoStopTimeout) {
                clearTimeout(this.autoStopTimeout);
                this.autoStopTimeout = null;
            }
        } else if (this.isPlaying && !this.isSilenced) {
            // Fire no longer detected but alarm is playing
            // Start auto-stop timer if not already running
            if (!this.autoStopTimeout && this.lastFireDetectedTime > 0) {
                const timeSinceLastFire = Date.now() - this.lastFireDetectedTime;
                const remainingTime = Math.max(0, this.autoStopDelay - timeSinceLastFire);
                
                this.autoStopTimeout = setTimeout(() => {
                    console.log('Auto-stopping alarm - fire no longer detected');
                    this.silence();
                    
                    // Callback to notify app
                    if (this.onAutoStop) {
                        this.onAutoStop();
                    }
                }, remainingTime);
            }
        }
    }

    /**
     * Trigger visual flash effect
     */
    flash() {
        this.alertFlash.classList.add('active');
        
        setTimeout(() => {
            this.alertFlash.classList.remove('active');
        }, 500);
        
        // Flash multiple times for urgency
        setTimeout(() => {
            if (this.flashEnabled && !this.isSilenced) {
                this.alertFlash.classList.add('active');
                setTimeout(() => {
                    this.alertFlash.classList.remove('active');
                }, 500);
            }
        }, 600);
    }

    /**
     * Enable/disable sound alerts
     */
    setSoundEnabled(enabled) {
        this.soundEnabled = enabled;
        if (!enabled) {
            this.stopAlarm();
        }
    }

    /**
     * Enable/disable flash alerts
     */
    setFlashEnabled(enabled) {
        this.flashEnabled = enabled;
    }

    /**
     * Reset alert state
     */
    reset() {
        this.stopAlarm();
        this.currentAlert = null;
        this.lastAlertTime = 0;
    }
}

// Export for use in other modules
window.AlertManager = AlertManager;
