import { useEffect, useRef, useState } from 'react';
import type { Material } from 'three';
import type { Preferences } from './api';
import { avatarColors, defaultAvatar, type AvatarStyle } from './avatar-style';

// Character colors stay human in both themes; the cardigan follows the app palette.
const portrait = { skin: '#f1bf9f', hair: '#49312e', blush: '#df8d89', white: '#fff5e8', ink: '#352a30' };
const outfit = { rose: '--cp-accent', sunny: '--cp-warning', mint: '--cp-success' };

export default function Teacher({ speaking, label, appearance = 'rose', mood = 'gentle', customization = defaultAvatar }: {
  speaking: boolean; label: string; appearance?: Preferences['appearance']; mood?: Preferences['mood'];
  customization?: AvatarStyle;
}) {
  const host = useRef<HTMLDivElement>(null);
  const talking = useRef(speaking);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  useEffect(() => { talking.current = speaking; }, [speaking]);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    setStatus('loading');
    void import('three').then(THREE => {
      if (disposed || !host.current) return;
      const container = host.current;
      const stage = container.parentElement!;
      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
      catch { setStatus('unavailable'); return; }
      const resources: { dispose(): void }[] = [];
      function own<T extends { dispose(): void }>(resource: T) {
        resources.push(resource);
        return resource;
      }
      let cleaned = false;
      let stop = () => {};
      cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        stop();
        resources.forEach(resource => resource.dispose());
        renderer.dispose();
        renderer.domElement.remove();
      };
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(35, 1, .1, 100);
      camera.position.set(0, .18, 6.6);
      camera.lookAt(0, .12, 0);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      container.appendChild(renderer.domElement);
      renderer.domElement.setAttribute('aria-hidden', 'true');
      const color = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      const skin = own(new THREE.MeshStandardMaterial({ color: portrait.skin, roughness: .8 }));
      const hair = own(new THREE.MeshStandardMaterial({ color: avatarColors[customization.hair], roughness: .75 }));
      const clothing = own(new THREE.MeshStandardMaterial({ roughness: .9 }));
      const collar = own(new THREE.MeshStandardMaterial({ color: portrait.white, roughness: .9 }));
      const eyeWhite = own(new THREE.MeshBasicMaterial({ color: portrait.white }));
      const ink = own(new THREE.MeshBasicMaterial({ color: portrait.ink }));
      const updateColors = () => {
        clothing.color.set(customization.shirt === 'theme' ? color(outfit[appearance]) || portrait.blush : avatarColors[customization.shirt]);
        clothing.color.lerp(new THREE.Color(portrait.white), .18);
      };
      updateColors();
      const light = new THREE.HemisphereLight(portrait.white, portrait.hair, 2.2);
      scene.add(light);
      const key = new THREE.DirectionalLight(portrait.white, 2.8);
      key.position.set(-3, 5, 6);
      scene.add(key);
      const teacher = new THREE.Group();
      scene.add(teacher);
      const ball = own(new THREE.SphereGeometry(1, 40, 32));
      const part = (material: Material, scale: number[], position: number[], parent = teacher) => {
        const mesh = new THREE.Mesh(ball, material);
        mesh.scale.set(scale[0], scale[1], scale[2]);
        mesh.position.set(position[0], position[1], position[2]);
        parent.add(mesh);
        return mesh;
      };
      part(clothing, [.76, .66, .35], [0, -.94, 0]);
      part(collar, [.24, .30, .045], [0, -.80, .33]);
      for (const side of [-1, 1]) {
        const arm = part(clothing, [.18, .42, .20], [side * .67, -.88, 0]);
        arm.rotation.z = side * .12;
        part(skin, [.10, .13, .08], [side * .72, -1.24, .08]);
        part(skin, [.045, .07, .055], [side * .63, -1.22, .13]);
        for (let finger = 0; finger < 4; finger++) {
          part(skin, [.024, .065, .035], [side * .72 + (finger - 1.5) * .043, -1.33, .08]);
        }
      }
      part(skin, [.18, .20, .18], [0, -.23, .02]);
      const leftCollar = part(collar, [.22, .10, .07], [-.19, -.46, .33]);
      const rightCollar = part(collar, [.22, .10, .07], [.19, -.46, .33]);
      leftCollar.rotation.z = -.5;
      rightCollar.rotation.z = .5;
      part(collar, [.04, .04, .025], [-.32, -.85, .34]);
      part(collar, [.04, .04, .025], [-.32, -1.09, .32]);

      const head = new THREE.Group();
      head.position.set(0, .66, 0);
      teacher.add(head);
      part(hair, [.73, .86, .51], [0, .02, -.12], head);
      for (const side of [-1, 1]) {
        part(hair, [.17, customization.hairLength === 'long' ? .48 : .23, .25],
          [side * .60, customization.hairLength === 'long' ? -.17 : .13, -.01], head);
      }
      part(skin, [.14, .20, .13], [-.63, -.07, .08], head);
      part(skin, [.14, .20, .13], [.63, -.07, .08], head);
      part(skin, [.64, .75, .53], [0, 0, .06], head);
      const fringeLeft = part(hair, [.47, .20, .19], [-.24, .56, .39], head);
      fringeLeft.rotation.z = .35;
      const fringeRight = part(hair, [.29, .17, .18], [.37, .59, .34], head);
      fringeRight.rotation.z = -.5;
      part(hair, [.31, .16, .19], [-.17, .75, .12], head).rotation.z = .15;
      const clip = part(clothing, [.11, .035, .03], [.53, .39, .43], head);
      clip.rotation.z = -.65;
      const eyes = new THREE.Group();
      head.add(eyes);
      part(eyeWhite, [.11, .13, .04], [-.235, .06, .55], eyes);
      part(eyeWhite, [.11, .13, .04], [.235, .06, .55], eyes);
      part(ink, [.055, .085, .02], [-.225, .055, .595], eyes);
      part(ink, [.055, .085, .02], [.225, .055, .595], eyes);
      part(eyeWhite, [.025, .03, .012], [-.247, .09, .634], eyes);
      part(eyeWhite, [.025, .03, .012], [.203, .09, .634], eyes);
      const leftBrow = part(hair, [.125, .027, .025], [-.235, .30, .53], head);
      const rightBrow = part(hair, [.125, .027, .025], [.235, .30, .53], head);
      leftBrow.rotation.z = .12;
      rightBrow.rotation.z = -.12;
      part(skin, [.065, .08, .065], [0, -.105, .58], head);
      if (customization.glasses) {
        const frameGeometry = own(new THREE.TorusGeometry(.15, .015, 8, 32));
        for (const side of [-1, 1]) {
          const frame = new THREE.Mesh(frameGeometry, ink);
          frame.position.set(side * .235, .06, .63);
          head.add(frame);
        }
        part(ink, [.09, .015, .015], [0, .06, .63], head);
      }
      const mouth = part(ink, [.13, .035, .025], [0, -.33, .55], head);
      const smileCurve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(-.14, -.29, .55),
        new THREE.Vector3(0, mood === 'cheerful' ? -.47 : mood === 'calm' ? -.35 : -.41, .61),
        new THREE.Vector3(.14, -.29, .55),
      );
      const smileGeometry = own(new THREE.TubeGeometry(smileCurve, 24, .018, 8, false));
      const smile = new THREE.Mesh(smileGeometry, ink);
      head.add(smile);
      // Eye direction is toward this virtual camera only, never a device camera.
      head.lookAt(camera.position);
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
      let frame = 0;
      let lost = false;
      const draw = (time: number) => {
        const seconds = time / 1000;
        eyes.scale.y = !reduced.matches && seconds % 4.7 > 4.55 ? .12 : 1;
        mouth.scale.y = talking.current && !reduced.matches ? .045 + Math.abs(Math.sin(seconds * 12)) * .055 : .035;
        smile.visible = !talking.current;
        mouth.visible = talking.current;
        teacher.position.y = reduced.matches ? 0 : Math.sin(seconds * (mood === 'calm' ? .8 : 1.6)) * (mood === 'cheerful' ? .035 : .015);
        renderer.render(scene, camera);
      };
      const animate = (time: number) => {
        if (disposed || lost) return;
        try { if (!document.hidden) draw(time); }
        catch { cleanup(); setStatus('unavailable'); return; }
        if (lost) return;
        frame = requestAnimationFrame(animate);
      };
      const resize = new ResizeObserver(() => {
        if (lost || disposed) return;
        try { fit(); draw(0); }
        catch { cleanup(); setStatus('unavailable'); }
      });
      // Measure the stage: the canvas is hidden while the first frame is prepared.
      const fit = () => {
        const width = Math.max(stage.clientWidth, 1);
        const height = Math.max(stage.clientHeight, 1);
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      const observer = new MutationObserver(updateColors);
      const contextLost = (event: Event) => {
        event.preventDefault();
        lost = true;
        cancelAnimationFrame(frame);
        setStatus('unavailable');
      };
      const contextRestored = () => {
        if (disposed || !lost) return;
        lost = false;
        try {
          fit();
          draw(0);
          if (lost) return;
          setStatus('ready');
          frame = requestAnimationFrame(animate);
        } catch { lost = true; setStatus('unavailable'); }
      };
      stop = () => {
        cancelAnimationFrame(frame);
        resize.disconnect();
        observer.disconnect();
        renderer.domElement.removeEventListener('webglcontextlost', contextLost);
        renderer.domElement.removeEventListener('webglcontextrestored', contextRestored);
      };
      renderer.domElement.addEventListener('webglcontextlost', contextLost);
      renderer.domElement.addEventListener('webglcontextrestored', contextRestored);
      resize.observe(stage);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      fit();
      draw(0);
      if (!lost) {
        setStatus('ready');
        frame = requestAnimationFrame(animate);
      }
    }).catch(() => {
      cleanup();
      if (!disposed) setStatus('unavailable');
    });
    return () => { disposed = true; cleanup(); };
  }, [appearance, mood, customization.shirt, customization.hair, customization.hairLength, customization.glasses]);

  return <div className="teacher-stage" role="img" aria-label={label}>
    <div className="teacher-orbit" aria-hidden="true" />
    <div ref={host} className="teacher-canvas" hidden={status !== 'ready'} />
    {status !== 'ready' && <div className="teacher-fallback" aria-hidden="true">
      <svg viewBox="0 0 200 220" focusable="false" style={{ overflow: 'visible' }}>
        <g fill={avatarColors[customization.hair]}>
          <path d="M47 98C25 12 158 0 154 86l-2 49H47Z" />
          {customization.hairLength === 'long' && <><ellipse cx="46" cy="111" rx="14" ry="31" /><ellipse cx="151" cy="111" rx="14" ry="31" /></>}
        </g>
        <g fill={customization.shirt === 'theme' ? `var(${outfit[appearance]})` : avatarColors[customization.shirt]}>
          <path d="M31 220v-29c0-34 25-53 68-53s64 19 64 53v29Z" />
          <path d="M39 168q-17 9-13 36l18 1 11-27ZM153 168q17 9 13 36l-18 1-11-27Z" />
        </g>
        <g fill={portrait.skin}>
          <path d="M86 121h26v29q-13 13-26 0Z" />
          <ellipse cx="46" cy="88" rx="10" ry="15" /><ellipse cx="151" cy="88" rx="10" ry="15" />
          <path d="M27 202q-4 14 5 16h8q8-2 3-15ZM149 203q-5 13 3 15h8q9-2 5-16Z" />
          <path d="M49 73q-1-44 49-44t50 44v23c0 31-22 49-49 49S49 127 49 96Z" />
        </g>
        <path fill={portrait.white} d="m81 145 18 12 18-12-5 75H86Z" />
        <path fill={portrait.white} d="m85 139 14 12-15 13-10-19Zm28 0-14 12 15 13 10-19Z" />
        <path fill={avatarColors[customization.hair]} d="M46 76C37 31 63 17 95 18c38-2 62 26 57 59-16-3-27-15-33-29-15 18-39 24-73 28Z" />
        <path stroke={customization.shirt === 'theme' ? `var(${outfit[appearance]})` : avatarColors[customization.shirt]} strokeWidth="5" strokeLinecap="round" d="m140 53 5 11" />
        <g fill={portrait.white}>
          <ellipse cx="78" cy="88" rx="11" ry="13" /><ellipse cx="121" cy="88" rx="11" ry="13" />
        </g>
        <g fill={portrait.ink}>
          <ellipse cx="79" cy="89" rx="6" ry="9" /><ellipse cx="120" cy="89" rx="6" ry="9" />
        </g>
        <g fill={portrait.white}>
          <circle cx="77" cy="86" r="2.5" /><circle cx="118" cy="86" r="2.5" />
          <circle cx="72" cy="179" r="2.5" /><circle cx="72" cy="199" r="2.5" />
        </g>
        <g fill="none" stroke={avatarColors[customization.hair]} strokeWidth="3" strokeLinecap="round">
          <path d="M68 69q9-5 18-1M113 68q9-4 18 1" />
        </g>
        {customization.glasses && <g fill="none" stroke={portrait.ink} strokeWidth="3">
          <circle cx="78" cy="88" r="16" /><circle cx="121" cy="88" r="16" /><path d="M94 88h11" />
        </g>}
        <path d="M98 97q-6 13 3 12" fill="none" stroke={portrait.blush} strokeWidth="2" strokeLinecap="round" />
        {speaking
          ? <ellipse cx="99" cy="121" rx="9" ry="6" fill={portrait.ink} />
          : <path d={mood === 'cheerful' ? 'M87 118q12 19 24 0' : mood === 'calm' ? 'M90 120q9 5 18 0' : 'M88 119q11 12 22 0'} fill="none" stroke={portrait.ink} strokeWidth="3" strokeLinecap="round" />}
      </svg>
    </div>}
    <span className="teacher-caption">{label}</span>
  </div>;
}
