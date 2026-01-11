
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GameState, Pose, MatchResult } from './types';
import { POSES, GAME_DURATION } from './constants';
import { evaluatePoseOffline } from './services/poseService';

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>(GameState.START);
  const [currentPose, setCurrentPose] = useState<Pose | null>(null);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  const [lastResult, setLastResult] = useState<MatchResult | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [lives, setLives] = useState(3);
  const [isTracking, setIsTracking] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [savePhotos, setSavePhotos] = useState(false);
  const [cameraResolution, setCameraResolution] = useState({ width: 640, height: 480 });

  // Use Refs for values needed in high-frequency loops to avoid re-initializing logic
  const timeLeftRef = useRef(GAME_DURATION);
  const gameStateRef = useRef<GameState>(GameState.START);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<number | null>(null);
  const lastPoseResults = useRef<any>(null);
  const renderLoopRef = useRef<number | null>(null);
  const isInitializingRef = useRef(false);
  const poseInstanceRef = useRef<any>(null);
  const isProcessingRef = useRef(false);

  // Keep refs in sync with state
  useEffect(() => {
    timeLeftRef.current = timeLeft;
  }, [timeLeft]);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  // High-performance render loop for the UI - defined once
  const draw = useCallback(() => {
    if (!overlayCanvasRef.current || !videoRef.current) {
      renderLoopRef.current = requestAnimationFrame(draw);
      return;
    }

    const canvas = overlayCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const video = videoRef.current;
    const win = window as any;
    const { drawConnectors, drawLandmarks, POSE_CONNECTIONS } = win;

    if (!ctx || video.readyState < 2) {
      renderLoopRef.current = requestAnimationFrame(draw);
      return;
    }

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Mirror and Draw Video Frame
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Draw Skeleton Landmarks
    const results = lastPoseResults.current;
    if (results?.poseLandmarks && drawConnectors && drawLandmarks && POSE_CONNECTIONS) {
      try {
        if (Array.isArray(results.poseLandmarks) && results.poseLandmarks.length > 0) {
          // Use refs to determine visual style without re-triggering the loop setup
          const isWarning = timeLeftRef.current < 1500 && gameStateRef.current === GameState.PLAYING;
          drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, {
            color: isWarning ? '#f43f5e' : '#06b6d4',
            lineWidth: 4,
          });
          drawLandmarks(ctx, results.poseLandmarks, {
            color: '#ffffff',
            fillColor: '#06b6d4',
            lineWidth: 1,
            radius: 3,
          });
        }
      } catch (e) {}
    }
    ctx.restore();

    renderLoopRef.current = requestAnimationFrame(draw);
  }, []); // Constant reference

  // Throttled processing loop for MediaPipe at 30 FPS
  useEffect(() => {
    let frameId: number;
    let lastTime = 0;
    const targetFps = 30;
    const interval = 1000 / targetFps;

    const processFrame = async (now: number) => {
      if (!lastTime) lastTime = now;
      const elapsed = now - lastTime;

      if (elapsed >= interval) {
        if (!isProcessingRef.current && videoRef.current && videoRef.current.readyState >= 2 && poseInstanceRef.current) {
          isProcessingRef.current = true;
          try {
            await poseInstanceRef.current.send({ image: videoRef.current });
            lastTime = now - (elapsed % interval);
          } catch (e) {
          } finally {
            isProcessingRef.current = false;
          }
        }
      }
      frameId = requestAnimationFrame(processFrame);
    };
    
    if (isCameraReady) {
      frameId = requestAnimationFrame(processFrame);
    }
    
    return () => cancelAnimationFrame(frameId);
  }, [isCameraReady]);

  // MediaPipe & Camera Initialization - Runs only once
  useEffect(() => {
    if (isInitializingRef.current) return;
    isInitializingRef.current = true;

    let stream: MediaStream | null = null;
    let isActive = true;

    const init = async () => {
      const win = window as any;
      if (!win.Pose) {
        if (isActive) setTimeout(init, 500);
        return;
      }

      try {
        const VERSION = '0.5.1675469404';
        const pose = new win.Pose({
          locateFile: (file: string) => {
            if (file.startsWith('https://')) return file;
            return `https://cdn.jsdelivr.net/npm/@mediapipe/pose@${VERSION}/${file}`;
          },
        });

        pose.setOptions({
          modelComplexity: 0, 
          smoothLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        pose.onResults((results: any) => {
          if (!isActive) return;
          setIsTracking(true);
          lastPoseResults.current = results;
        });

        poseInstanceRef.current = pose;

        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { 
              width: { ideal: cameraResolution.width }, 
              height: { ideal: cameraResolution.height }, 
              frameRate: { ideal: 30, max: 30 } 
            },
            audio: false
          });
          
          if (videoRef.current && isActive) {
            videoRef.current.srcObject = stream;
            videoRef.current.onloadedmetadata = () => {
              if (videoRef.current) {
                videoRef.current.play();
                setIsCameraReady(true);
                // Start the loop only once
                renderLoopRef.current = requestAnimationFrame(draw);
              }
            };
          }
        } catch (err: any) {
          console.error("Camera Access Denied:", err);
          setCameraError(err.message || "Could not access camera.");
        }
      } catch (err: any) {
        console.error("MediaPipe Init Error:", err);
      }
    };

    init();

    return () => {
      isActive = false;
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      if (poseInstanceRef.current) {
        try { poseInstanceRef.current.close(); } catch (e) {}
      }
      if (renderLoopRef.current) cancelAnimationFrame(renderLoopRef.current);
      isInitializingRef.current = false;
    };
  }, [draw]); // draw is now constant

  const nextRound = useCallback(() => {
    const randomPose = POSES[Math.floor(Math.random() * POSES.length)];
    setCurrentPose(randomPose);
    setTimeLeft(GAME_DURATION);
    setGameState(GameState.PLAYING);
    setLastResult(null);
  }, []);

  const startGame = () => {
    setScore(0);
    setLives(3);
    nextRound();
  };

  const handleJudging = async () => {
    setGameState(GameState.JUDGING);
    
    // OFFLINE EVALUATION: Use the current landmarks instead of Gemini API
    const landmarks = lastPoseResults.current?.poseLandmarks;
    
    // Small artificial delay to show "Analyzing" screen for UX
    setTimeout(() => {
      if (currentPose) {
        const result = evaluatePoseOffline(landmarks, currentPose);
        setLastResult(result);
        
        // Save photo if enabled and pose matched
        if (result.matched && savePhotos && videoRef.current) {
          capturePhoto(currentPose.name);
        }
        
        if (result.matched) {
          setScore(prev => prev + result.score);
        } else {
          setLives(prev => prev - 1);
        }
        setGameState(GameState.RESULT);
      }
    }, 800);
  };

  const capturePhoto = (poseName: string) => {
    if (!videoRef.current || !canvasRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) return;
    
    // Set canvas size to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    // Draw current video frame (mirrored)
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.restore();
    
    // Convert to blob and download
    canvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `neural-pulse-${poseName}-${Date.now()}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    }, 'image/jpeg', 0.9);
  };

  useEffect(() => {
    if (gameState === GameState.PLAYING) {
      timerRef.current = window.setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 100) {
            if (timerRef.current) clearInterval(timerRef.current);
            handleJudging();
            return 0;
          }
          return prev - 100;
        });
      }, 100);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [gameState, currentPose]);

  useEffect(() => {
    if (lives <= 0 && gameState !== GameState.GAMEOVER && gameState !== GameState.START) {
      setGameState(GameState.GAMEOVER);
    }
  }, [lives, gameState]);

  return (
    <div className="relative w-full h-screen overflow-hidden flex flex-col items-center justify-center text-white font-sans selection:bg-cyan-500 bg-slate-950">
      
      <div className="relative z-10 w-full max-w-7xl flex flex-col gap-4 px-4 h-full py-4 lg:py-8">
        
        <div className="flex-1 relative rounded-[48px] overflow-hidden bg-black border-[4px] border-slate-800 shadow-2xl">
          
          <video ref={videoRef} autoPlay playsInline muted className="hidden" />
          <div className="absolute inset-0 flex items-center justify-center">
            <canvas 
              ref={overlayCanvasRef} 
              width={640} 
              height={480}
              className="absolute inset-0 w-full h-full object-cover z-10"
            />
            <div className="scanner-line"></div>
            {cameraError && (
              <div className="absolute inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-8 text-center">
                <div className="text-6xl mb-4">📷🚫</div>
                <h3 className="text-2xl font-black text-rose-500 mb-2">СБОЙ КАМЕРЫ</h3>
                <p className="text-slate-400 mb-6">{cameraError}</p>
                <button onClick={() => window.location.reload()} className="px-8 py-3 bg-white text-black font-black rounded-xl">ПОВТОРИТЬ</button>
              </div>
            )}
          </div>

          <canvas ref={canvasRef} className="hidden" />

          {/* Полоска прибытия стены поверх поля по центру сверху */}
          <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-slate-900/60 backdrop-blur-xl px-6 py-3 rounded-2xl border border-white/10 shadow-xl z-20">
            <div className="flex items-center gap-4">
              <span className="text-[10px] uppercase tracking-widest text-cyan-400 font-black">Прибытие стены</span>
              <div className="w-32 h-2 bg-slate-800/50 rounded-full overflow-hidden border border-white/10 p-[1px]">
                <div 
                  className={`h-full rounded-full transition-all duration-100 ease-linear ${timeLeft < 1500 ? 'bg-rose-500 shadow-[0_0_10px_#f43f5e]' : 'bg-cyan-500 shadow-[0_0_12px_#06b6d4]'}`}
                  style={{ width: `${(timeLeft / GAME_DURATION) * 100}%` }}
                ></div>
              </div>
            </div>
          </div>

          {/* Счёт слева внизу */}
          <div className="absolute bottom-4 left-4 bg-slate-900/60 backdrop-blur-xl px-4 py-3 rounded-2xl border border-white/10 shadow-xl z-20">
            <div className="flex flex-col items-center">
              <span className="text-[10px] uppercase tracking-widest text-cyan-400 font-black mb-1">Счёт</span>
              <span className="text-3xl font-black tabular-nums leading-none">{score}</span>
            </div>
          </div>

          {/* Единицы целостности справа внизу */}
          <div className="absolute bottom-4 right-4 bg-slate-900/60 backdrop-blur-xl px-4 py-3 rounded-2xl border border-white/10 shadow-xl z-20">
            <div className="flex gap-2.5">
              {[...Array(3)].map((_, i) => (
                <div key={i} className={`w-5 h-5 rounded-full border border-white/20 transition-all duration-700 ${i < lives ? 'bg-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.8)]' : 'bg-slate-800 scale-75 opacity-30'}`}></div>
              ))}
            </div>
          </div>

          {gameState === GameState.PLAYING && (
             <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
                <div 
                  className="wall-animation flex flex-col items-center justify-center bg-yellow-400/5 border-[12px] border-yellow-400/60 rounded-[60px] backdrop-blur-[1px]"
                  style={{ 
                    width: '60%', 
                    height: '80%', 
                    animationDuration: `${GAME_DURATION}ms`,
                    boxShadow: '0 0 80px rgba(250,204,21,0.2), inset 0 0 60px rgba(250,204,21,0.15)'
                  }}
                >
                  <div className="text-[120px] mb-8 drop-shadow-[0_0_30px_rgba(250,204,21,1)] filter brightness-125">{currentPose?.icon}</div>
                  <div className="text-5xl font-black uppercase text-white drop-shadow-2xl text-center px-10 tracking-tighter">
                    {currentPose?.name}
                  </div>
                  <div className="mt-6 px-8 py-3 bg-black/60 rounded-full border border-yellow-400/30 text-[10px] font-black tracking-[0.4em] text-yellow-400">
                    ТРЕБУЕТСЯ СОВПАДЕНИЕ
                  </div>
                </div>
             </div>
          )}

          {gameState === GameState.START && (
            <div className="absolute inset-0 bg-slate-950/95 backdrop-blur-3xl flex flex-col items-center justify-center text-center p-12 z-[60]">
              <div className="w-24 h-24 bg-cyan-500 rounded-3xl rotate-12 mb-8 flex items-center justify-center text-5xl shadow-[0_0_40px_rgba(6,182,212,0.5)]">🤸</div>
              <h1 className="text-7xl font-black mb-6 tracking-tighter">NEURAL<br/><span className="text-cyan-400">PULSE</span></h1>
              <p className="text-slate-400 max-w-lg mb-8 text-lg leading-relaxed">Система инициализирована. Совпадайте позы с высокой точностью. Теперь с 100% офлайн нейронной обработкой.</p>
              
              <div className="mb-6 flex items-center gap-4 bg-white/5 rounded-2xl p-4 border border-white/10">
                <button 
                  onClick={() => setSavePhotos(!savePhotos)}
                  className={`relative w-16 h-8 rounded-full transition-colors duration-300 ${savePhotos ? 'bg-cyan-500' : 'bg-slate-600'}`}
                >
                  <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-transform duration-300 ${savePhotos ? 'translate-x-8' : 'translate-x-1'}`}></div>
                </button>
                <span className="text-sm font-medium text-slate-300">
                  {savePhotos ? '📸 Фото ВКЛ' : '📷 Фото ВЫКЛ'}
                </span>
              </div>

              <div className="mb-8 bg-white/5 rounded-2xl p-4 border border-white/10">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-slate-300">🎥 Разрешение камеры</span>
                  <span className="text-xs text-cyan-400">{cameraResolution.width}x{cameraResolution.height}</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { width: 424, height: 240, label: 'Низкое' },
                    { width: 640, height: 480, label: 'Стандарт' },
                    { width: 1280, height: 720, label: 'HD' }
                  ].map((res) => (
                    <button
                      key={`${res.width}x${res.height}`}
                      onClick={() => setCameraResolution({ width: res.width, height: res.height })}
                      className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                        cameraResolution.width === res.width && cameraResolution.height === res.height
                          ? 'bg-cyan-500 text-white'
                          : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                      }`}
                    >
                      {res.label}
                    </button>
                  ))}
                </div>
              </div>
              
              <button 
                onClick={startGame}
                disabled={!isCameraReady}
                className="group relative px-16 py-6 bg-white text-slate-950 font-black rounded-2xl text-2xl transition-all hover:scale-105 active:scale-95 disabled:opacity-30 overflow-hidden"
              >
                <span className="relative z-10">{isCameraReady ? "АКТИВИРОВАТЬ СИСТЕМУ" : "УСТАНОВКА СВЯЗИ..."}</span>
                <div className="absolute inset-0 bg-cyan-400 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
              </button>
            </div>
          )}

          {gameState === GameState.JUDGING && (
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xl flex flex-col items-center justify-center z-[60]">
              <div className="relative">
                <div className="w-24 h-24 border-4 border-cyan-500/20 rounded-full animate-ping"></div>
                <div className="absolute inset-0 w-24 h-24 border-t-4 border-cyan-400 rounded-full animate-spin"></div>
              </div>
              <p className="mt-8 font-black text-2xl uppercase tracking-[0.5em] text-cyan-400">АНАЛИЗ ПОЗЫ...</p>
            </div>
          )}

          {gameState === GameState.RESULT && (
            <div className="absolute inset-0 flex items-center justify-center z-[70] px-6">
              <div className="bg-slate-900/95 border-2 border-white/10 p-10 rounded-[40px] shadow-2xl backdrop-blur-2xl flex flex-col items-center text-center w-full max-w-md animate-in fade-in zoom-in duration-300">
                 <div className="text-7xl mb-6">{lastResult?.matched ? '🎯' : '⚠️'}</div>
                 <h2 className={`text-5xl font-black mb-4 ${lastResult?.matched ? 'text-green-400' : 'text-rose-500'}`}>
                   {lastResult?.matched ? 'СОВПАДЕНИЕ' : 'РАССИНХРОН'}
                 </h2>
                 <p className="text-slate-400 mb-8 text-lg">{lastResult?.feedback}</p>
                 <div className="flex gap-4 w-full">
                   <div className="flex-1 bg-white/5 rounded-2xl p-4">
                     <div className="text-[10px] uppercase text-slate-500 font-bold mb-1">Набор</div>
                     <div className="text-2xl font-black">+{lastResult?.score || 0}</div>
                   </div>
                 </div>
                 <button 
                     onClick={nextRound}
                   className="mt-8 w-full py-5 bg-cyan-500 hover:bg-cyan-400 text-white font-black rounded-2xl text-xl transition-all shadow-lg"
                 >
                   ПРОДОЛЖИТЬ
                 </button>
              </div>
            </div>
          )}

          {gameState === GameState.GAMEOVER && (
            <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center z-[100] animate-in slide-in-from-bottom duration-700">
               <div className="text-rose-500 font-mono text-sm mb-4 animate-pulse">ОШИБКА: СТРУКТУРНЫЙ СБОЙ</div>
               <h2 className="text-8xl font-black text-white mb-8 tracking-tighter">РАССИНХРОН</h2>
               <div className="text-center mb-16">
                 <div className="text-slate-500 text-xs uppercase font-black mb-1">Индекс производительности</div>
                 <div className="text-7xl font-black">{score}</div>
               </div>
               <button 
                 onClick={startGame}
                 className="px-20 py-6 bg-rose-600 hover:bg-rose-500 text-white font-black rounded-3xl text-3xl shadow-2xl transition-all hover:scale-105"
               >
                 ПЕРЕЗАГРУЗКА
               </button>
            </div>
          )}
        </div>

        <div className="flex justify-between items-center px-4 py-2">
           <div className="flex items-center gap-6">
             <div className="flex items-center gap-2">
               <div className={`w-2 h-2 rounded-full ${isTracking ? 'bg-green-500 animate-pulse' : 'bg-rose-500'}`}></div>
               <span className="text-[9px] uppercase font-black tracking-widest text-slate-500">Нейросвязь</span>
             </div>
             <div className="flex items-center gap-2">
               <div className={`w-2 h-2 rounded-full ${isCameraReady ? 'bg-green-500' : 'bg-slate-700'}`}></div>
               <span className="text-[9px] uppercase font-black tracking-widest text-slate-500">ОФЛАЙН РЕЖИМ</span>
             </div>
           </div>
           <div className="text-slate-600 text-[9px] font-bold uppercase tracking-widest">
             CORE: LOCAL_HEURISTICS_V1 // СТАТУС: БЕЗОПАСНО
           </div>
        </div>
      </div>
    </div>
  );
};

export default App;
