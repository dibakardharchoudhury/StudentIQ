import { useEffect, useRef, useState } from 'react';
import type { Material } from 'three';
import type { Preferences } from './api';

export default function Teacher({ speaking, label, appearance = 'rose', mood = 'gentle' }: {
  speaking: boolean; label: string; appearance?: Preferences['appearance']; mood?: Preferences['mood'];
}) {
  const host = useRef<HTMLDivElement>(null);
  const talking = useRef(speaking);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => { talking.current = speaking; }, [speaking]);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    void import('three').then(THREE => {
      if (disposed || !host.current) return;
      const container = host.current;
      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
      catch { setUnavailable(true); return; }
      setUnavailable(false);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(35, 1, .1, 100);
      camera.position.set(0, .25, 6.4);
      camera.lookAt(0, .22, 0);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      container.appendChild(renderer.domElement);
      renderer.domElement.setAttribute('aria-hidden', 'true');
      const css = () => getComputedStyle(document.documentElement);
      const color = (name: string) => css().getPropertyValue(name).trim();
      const appearanceColor = () => color(appearance === 'sunny' ? '--cp-warning' : appearance === 'mint' ? '--cp-success' : '--cp-accent');
      const skin = new THREE.MeshStandardMaterial({ roughness: .85 });
      const hair = new THREE.MeshStandardMaterial({ roughness: .9 });
      const clothing = new THREE.MeshStandardMaterial({ roughness: .8 });
      const collar = new THREE.MeshStandardMaterial({ roughness: .9 });
      const blush = new THREE.MeshStandardMaterial({ roughness: .9 });
      const eyeWhite = new THREE.MeshBasicMaterial();
      const ink = new THREE.MeshBasicMaterial();
      const updateColors = () => {
        const dark = document.documentElement.dataset.theme === 'dark';
        const lightColor = new THREE.Color(color(dark ? '--cp-text' : '--cp-surface'));
        const darkColor = new THREE.Color(color(dark ? '--cp-surface' : '--cp-text'));
        const accentColor = new THREE.Color(color('--cp-accent'));
        skin.color.copy(lightColor).lerp(new THREE.Color(color('--cp-warning')), .25);
        hair.color.copy(darkColor);
        clothing.color.set(appearanceColor());
        collar.color.copy(lightColor);
        blush.color.copy(skin.color).lerp(accentColor, .3);
        eyeWhite.color.copy(lightColor);
        ink.color.copy(darkColor);
      };
      updateColors();
      const lightTone = () => color(document.documentElement.dataset.theme === 'dark' ? '--cp-text' : '--cp-surface');
      const light = new THREE.HemisphereLight(lightTone(), color('--cp-text-muted'), 2.4);
      scene.add(light);
      const key = new THREE.DirectionalLight(lightTone(), 2.4);
      key.position.set(3, 5, 6);
      scene.add(key);
      const teacher = new THREE.Group();
      scene.add(teacher);
      const ball = new THREE.SphereGeometry(1, 32, 24);
      const part = (material: Material, scale: number[], position: number[], parent = teacher) => {
        const mesh = new THREE.Mesh(ball, material);
        mesh.scale.set(scale[0], scale[1], scale[2]);
        mesh.position.set(position[0], position[1], position[2]);
        parent.add(mesh);
        return mesh;
      };
      part(clothing, [.83, .72, .38], [0, -.82, 0]);
      const leftArm = part(clothing, [.28, .58, .28], [-.74, -.8, -.02]);
      const rightArm = part(clothing, [.28, .58, .28], [.74, -.8, -.02]);
      leftArm.rotation.z = -.3;
      rightArm.rotation.z = .3;
      part(skin, [.17, .18, .16], [-.88, -1.26, .03]);
      part(skin, [.17, .18, .16], [.88, -1.26, .03]);
      part(skin, [.21, .3, .2], [0, -.14, .04]);
      const leftCollar = part(collar, [.24, .12, .06], [-.20, -.39, .36]);
      const rightCollar = part(collar, [.24, .12, .06], [.20, -.39, .36]);
      leftCollar.rotation.z = -.48;
      rightCollar.rotation.z = .48;
      part(collar, [.055, .055, .035], [0, -.72, .39]);
      part(collar, [.055, .055, .035], [0, -.98, .37]);
      const head = new THREE.Group();
      head.position.set(0, .68, 0);
      teacher.add(head);
      part(hair, [.74, .91, .53], [0, -.04, -.12], head);
      part(hair, [.18, .61, .24], [-.64, -.20, .06], head);
      part(hair, [.18, .61, .24], [.64, -.20, .06], head);
      part(skin, [.13, .18, .10], [-.63, -.02, .08], head);
      part(skin, [.13, .18, .10], [.63, -.02, .08], head);
      part(skin, [.62, .75, .48], [0, 0, .05], head);
      const fringeLeft = part(hair, [.42, .20, .17], [-.29, .57, .41], head);
      fringeLeft.rotation.z = .35;
      const fringeRight = part(hair, [.35, .15, .15], [.31, .62, .39], head);
      fringeRight.rotation.z = -.25;
      part(eyeWhite, [.12, .13, .035], [-.24, .08, .50], head);
      part(eyeWhite, [.12, .13, .035], [.24, .08, .50], head);
      const left = part(ink, [.057, .082, .028], [-.24, .08, .536], head);
      const right = part(ink, [.057, .082, .028], [.24, .08, .536], head);
      const leftGlint = part(eyeWhite, [.018, .022, .012], [-.26, .11, .562], head);
      const rightGlint = part(eyeWhite, [.018, .022, .012], [.22, .11, .562], head);
      const leftBrow = part(hair, [.12, .025, .018], [-.24, .27, .48], head);
      const rightBrow = part(hair, [.12, .025, .018], [.24, .27, .48], head);
      leftBrow.rotation.z = .12;
      rightBrow.rotation.z = -.12;
      part(skin, [.065, .085, .06], [0, -.10, .54], head);
      part(blush, [.10, .045, .015], [-.39, -.16, .43], head);
      part(blush, [.10, .045, .015], [.39, -.16, .43], head);
      const mouth = part(ink, [.11, .025, .018], [0, -.31, .48], head);
      const smileGeometry = new THREE.TorusGeometry(.115, .018, 8, 24, Math.PI);
      const smile = new THREE.Mesh(smileGeometry, ink);
      smile.rotation.z = Math.PI;
      smile.position.set(0, -.27, .49);
      head.add(smile);
      // The teacher looks at the virtual camera; no device camera is accessed.
      head.lookAt(camera.position);
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
      const resize = new ResizeObserver(() => {
        const width = container.clientWidth;
        const height = container.clientHeight;
        if (!width || !height) return;
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      });
      resize.observe(container);
      const observer = new MutationObserver(() => {
        updateColors();
        light.color.set(lightTone());
        key.color.set(lightTone());
      });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      let frame = 0;
      const animate = (time: number) => {
        frame = requestAnimationFrame(animate);
        if (document.hidden) return;
        const seconds = time / 1000;
        const blink = !reduced.matches && seconds % 4.7 > 4.52 ? .12 : 1;
        left.scale.y = right.scale.y = .082 * blink;
        leftGlint.scale.y = rightGlint.scale.y = .022 * blink;
        mouth.scale.y = talking.current && !reduced.matches ? .025 + Math.abs(Math.sin(seconds * 12)) * .045 : .025;
        smile.visible = mood !== 'calm' && !talking.current;
        mouth.visible = !smile.visible;
        teacher.position.y = reduced.matches ? 0 : Math.sin(seconds * (mood === 'calm' ? .8 : 1.6)) * (mood === 'cheerful' ? .035 : .02);
        renderer.render(scene, camera);
      };
      frame = requestAnimationFrame(animate);
      const contextLost = (event: Event) => { event.preventDefault(); setUnavailable(true); };
      renderer.domElement.addEventListener('webglcontextlost', contextLost);
      cleanup = () => {
        cancelAnimationFrame(frame);
        resize.disconnect();
        observer.disconnect();
        renderer.domElement.removeEventListener('webglcontextlost', contextLost);
        ball.dispose();
        smileGeometry.dispose();
        skin.dispose(); hair.dispose(); clothing.dispose(); collar.dispose(); blush.dispose(); eyeWhite.dispose(); ink.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    }).catch(() => { if (!disposed) setUnavailable(true); });
    return () => { disposed = true; cleanup(); };
  }, [appearance, mood]);

  return <div className="teacher-stage" role="img" aria-label={label}>
    <div className="teacher-orbit" aria-hidden="true" />
    <div ref={host} className="teacher-canvas" hidden={unavailable} />
    {unavailable && <div className="teacher-fallback" aria-hidden="true">
      <svg viewBox="0 0 160 180" focusable="false">
        <path className="fallback-hair" d="M37 78C28 17 130 17 123 78v32H37Z" />
        <path className="fallback-shirt" d="M18 180c2-42 21-62 62-62s60 20 62 62Z" />
        <path className="fallback-face" d="M70 105h20v25H70Z" />
        <ellipse className="fallback-face" cx="80" cy="72" rx="39" ry="48" />
        <path className="fallback-hair" d="M40 58C43 23 62 17 81 17c24 0 39 15 39 41-18-1-31-9-40-18-8 9-21 17-40 18Z" />
        <circle className="fallback-hair" cx="66" cy="73" r="4" /><circle className="fallback-hair" cx="94" cy="73" r="4" />
        <path className="fallback-smile" d="M69 94q11 11 22 0" />
      </svg>
    </div>}
    <span className="teacher-caption">{label}</span>
  </div>;
}
