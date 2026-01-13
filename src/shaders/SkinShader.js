import * as THREE from 'three';
import { extend } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';

const SkinShaderMaterial = shaderMaterial(
  {
    uBaseTexture: new THREE.Texture(),
    uMaskTexture: new THREE.Texture(),
    uTattooTexture: new THREE.Texture(),
    uEraserTexture: new THREE.Texture(), // Camada da borracha
    
    uTattooPos: new THREE.Vector2(0.5, 0.5),
    uTattooScale: new THREE.Vector2(1, 1),
    uRotation: 0.0,
    uOpacity: 0.95,
    
    uCylindrical: 0.3,    // Intensidade do Envolver
    uGrain: 0.05,         // Ruído
    uSkinDetail: 0.3,     // Integração com poros
    uInkColor: new THREE.Color('#ffffff'), // Cor base (Branco = neutro para coloridos)
    uLightDir: new THREE.Vector2(0.0, 1.0), // Direção da luz
    
    uDebugMode: 0,
    uOutputOnlyTattoo: 0
  },
  // Vertex Shader
  `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  // Fragment Shader
  `
    precision highp float;

    uniform sampler2D uBaseTexture;
    uniform sampler2D uMaskTexture;
    uniform sampler2D uTattooTexture;
    uniform sampler2D uEraserTexture;
    
    uniform vec2 uTattooPos;
    uniform vec2 uTattooScale;
    uniform float uRotation;
    uniform float uOpacity;
    uniform float uCylindrical;
    uniform float uGrain;
    uniform float uSkinDetail;
    uniform vec3 uInkColor;
    uniform vec2 uLightDir;

    uniform int uDebugMode;
    uniform int uOutputOnlyTattoo;

    varying vec2 vUv;

    // --- FUNÇÕES AUXILIARES ---
    float random(vec2 co) { return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453); }
    float getLuminance(vec3 color) { return dot(color, vec3(0.299, 0.587, 0.114)); }

    vec2 rotateUV(vec2 uv, float rotation) {
        float c = cos(rotation); float s = sin(rotation);
        uv -= 0.5; uv = vec2(c * uv.x + s * uv.y, -s * uv.x + c * uv.y); uv += 0.5;
        return uv;
    }

    void main() {
      vec4 baseColor = texture2D(uBaseTexture, vUv);
      vec4 maskColor = texture2D(uMaskTexture, vUv);
      
      // MODO DEBUG
      if (uDebugMode == 1) {
          if (maskColor.r > 0.1) gl_FragColor = mix(baseColor, vec4(0.0, 1.0, 0.0, 1.0), 0.5);
          else gl_FragColor = vec4(getLuminance(baseColor.rgb) * 0.5); return;
      }
      // Se não for pele e não estivermos exportando apenas a tattoo
      if (uOutputOnlyTattoo == 0 && maskColor.r < 0.1) { gl_FragColor = baseColor; return; }

      // --- 1. GEOMETRIA CILÍNDRICA (ENVOLVER) ---
      vec2 finalUV = vUv;
      finalUV -= uTattooPos - 0.5;
      finalUV = rotateUV(finalUV, uRotation);

      // Simulação física de projeção cilíndrica usando ArcSine
      float x = (finalUV.x - 0.5) * 2.0; 
      float xClamped = clamp(x, -0.99, 0.99); 
      float cylinderX = asin(xClamped) / 1.5708; // Pi/2
      
      // Mistura entre plano e cilindro baseado no slider
      float distortedX = mix(x, cylinderX, uCylindrical);
      
      finalUV.x = (distortedX * 0.5) + 0.5;
      finalUV = (finalUV - 0.5) / uTattooScale + 0.5;

      // Corta repetição fora da área
      if (finalUV.x < 0.0 || finalUV.x > 1.0 || finalUV.y < 0.0 || finalUV.y > 1.0) {
          if (uOutputOnlyTattoo == 1) gl_FragColor = vec4(0.0); else gl_FragColor = baseColor;
          return;
      }

      // --- 2. TEXTURA E COR ---
      vec4 rawTattoo = texture2D(uTattooTexture, finalUV);
      float tattooAlpha = rawTattoo.a;

      // Detecta se a tatuagem é colorida (Saturação alta ou Luminância alta)
      float tattooLuma = getLuminance(rawTattoo.rgb);
      float saturation = length(rawTattoo.rgb - vec3(tattooLuma));
      
      // Se tiver cor, usamos 1.0. Se for preto e branco, usamos 0.0
      float isColorInk = smoothstep(0.1, 0.3, saturation) + smoothstep(0.6, 0.9, tattooLuma);
      isColorInk = clamp(isColorInk, 0.0, 1.0);

      // --- 3. ILUMINAÇÃO (NORMAL MAP FAKE) ---
      float skinLuma = getLuminance(baseColor.rgb);
      float dX = getLuminance(texture2D(uBaseTexture, vUv + vec2(0.002, 0.0)).rgb) - skinLuma;
      float dY = getLuminance(texture2D(uBaseTexture, vUv + vec2(0.0, 0.002)).rgb) - skinLuma;
      vec3 normal = normalize(vec3(dX * 10.0, dY * 10.0, 0.8));
      
      vec3 lightVec = normalize(vec3(uLightDir.x, uLightDir.y, 0.5));
      
      // Especular (Brilho da tinta)
      vec3 viewDir = vec3(0.0, 0.0, 1.0);
      vec3 reflectDir = reflect(-lightVec, normal);
      float specular = pow(max(0.0, dot(viewDir, reflectDir)), 12.0) * (1.0 - uSkinDetail) * 0.3;

      // Integração (Luz difusa passando pela tinta)
      float diffuse = dot(normal, lightVec);
      float integrationFactor = mix(uSkinDetail * 1.5, uSkinDetail * 0.5, isColorInk);
      float lighting = mix(1.0, diffuse, integrationFactor);

      // --- 4. APLICAÇÃO ---
      // Adiciona ruído e aplica a cor base (uInkColor)
      vec3 tintedTattoo = rawTattoo.rgb * uInkColor; 
      vec3 noisyTattoo = tintedTattoo + (random(finalUV * 50.0) - 0.5) * uGrain;
      
      vec3 litTattoo = noisyTattoo * lighting + specular;

      // MISTURA HÍBRIDA:
      // - Multiply: Melhor para PRETO (escurece a pele)
      vec3 multiplyBlend = baseColor.rgb * litTattoo;
      // - Overlay/Normal: Melhor para COR (cobre a pele preservando sombras)
      vec3 colorBlend = mix(baseColor.rgb, litTattoo, 0.9 + specular); 

      vec3 finalColor = mix(multiplyBlend, colorBlend, isColorInk);

      // --- 5. MÁSCARAS FINAIS ---
      // Lê a borracha
      float eraserValue = texture2D(uEraserTexture, vUv).r;
      float eraserMultiplier = 1.0 - smoothstep(0.1, 0.3, eraserValue);
      
      // Sombra Cilíndrica (Profundidade nas bordas do braço)
      float edgeDepth = pow(abs(finalUV.x - 0.5) * 2.0, 3.0);
      float cylinderShadow = 1.0 - (edgeDepth * uCylindrical * 0.5);

      // Fade na borda da imagem quadrada
      vec2 centerDist = abs(finalUV - 0.5) * 2.0;
      float edgeFade = smoothstep(1.0, 0.9, max(centerDist.x, centerDist.y));

      float finalAlpha = uOpacity * tattooAlpha * edgeFade * eraserMultiplier;

      // Aplica sombra na cor final
      finalColor *= cylinderShadow;

      if (uOutputOnlyTattoo == 1) {
          gl_FragColor = vec4(finalColor, finalAlpha); return;
      }

      gl_FragColor = vec4(mix(baseColor.rgb, finalColor, finalAlpha), 1.0);
    }
  `
);

extend({ SkinShaderMaterial });