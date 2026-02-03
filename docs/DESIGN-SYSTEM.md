# Automata Design System

## Design Inspiration

**Primary Reference:** Gleb Kuznetsov / Milkinside  
**Dribbble:** https://dribbble.com/glebich  
**Behance:** https://www.behance.net/gleb

---

## Design Philosophy

> "A futuristic approach to design that is not inspired by what exists, but rather what could exist."  
> — Michelle Dong on Gleb Kuznetsov

> "One second of emotion can change the whole reality for people engaging with a product."  
> — Gleb Kuznetsov

**Core Principles:**
- **Fluid, not static** — interfaces should feel alive and responsive
- **Technical warmth** — cutting-edge without being cold
- **Purposeful motion** — animation as emotional storytelling
- **Clean density** — information-rich but never cluttered
- **Human-centered futurism** — technology serving people

---

## Color Palette

### Base Colors
| Name | Hex | Usage |
|------|-----|-------|
| White | `#FFFFFF` | Primary background |
| Off-white | `#FAFBFC` | Secondary background |
| Gray 50 | `#F8F9FA` | Card backgrounds, sections |
| Gray 100 | `#F1F3F4` | Borders, dividers |
| Gray 200 | `#E8EAED` | Subtle borders |
| Gray 300 | `#DADCE0` | Disabled states |
| Gray 600 | `#5F6368` | Secondary text |
| Gray 800 | `#3C4043` | Primary text |
| Gray 900 | `#202124` | Headlines, emphasis |

### Accent Colors
| Name | Hex | Usage |
|------|-----|-------|
| Accent Blue | `#4285F4` | Primary actions, links |
| Accent Cyan | `#00D4FF` | Highlights, gradients |
| Accent Violet | `#8B5CF6` | Secondary accents |

### Glow Colors (with opacity)
| Name | Value | Usage |
|------|-------|-------|
| Glow Blue | `rgba(66, 133, 244, 0.15)` | Icon backgrounds, hover states |
| Glow Cyan | `rgba(0, 212, 255, 0.1)` | Ambient lighting effects |

---

## Typography

### Font Stack
```css
--font-primary: 'Sora', 'SF Pro Display', -apple-system, sans-serif;
--font-mono: 'Space Mono', monospace;
```

### Type Scale
| Element | Size | Weight | Tracking |
|---------|------|--------|----------|
| H1 (Hero) | 56-72px | 600 | -0.02em |
| H2 (Section) | 40-48px | 600 | -0.01em |
| H3 (Card title) | 20-24px | 600 | normal |
| Body | 16-18px | 400 | normal |
| Body small | 14px | 400 | normal |
| Label | 11-12px | 500 | 0.1-0.2em |
| Mono/Technical | 12px | 400 | 0.1em |

### Special Treatments
- **Gradient text:** For hero headlines, use animated gradient fill
- **Section labels:** All caps, Space Mono, letter-spacing 0.2em, gray-600
- **Step numbers:** Space Mono, gray-300, small size

---

## Effects & Treatments

### Glass Card
```css
.glass-card {
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.8);
  border-radius: 24px;
  box-shadow: 
    0 4px 24px rgba(0, 0, 0, 0.04),
    0 1px 2px rgba(0, 0, 0, 0.02),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
}
```

### Fluid Blob (Background)
```css
.fluid-blob {
  background: linear-gradient(
    135deg,
    rgba(66, 133, 244, 0.08) 0%,
    rgba(0, 212, 255, 0.06) 50%,
    rgba(139, 92, 246, 0.04) 100%
  );
  filter: blur(60px);
  border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%;
  animation: morph 8s ease-in-out infinite;
}
```

### Glow Orb
```css
.glow-orb {
  background: radial-gradient(
    circle at center,
    rgba(66, 133, 244, 0.2) 0%,
    rgba(0, 212, 255, 0.1) 40%,
    transparent 70%
  );
  animation: pulse-glow 4s ease-in-out infinite;
}
```

### Dot Pattern
```css
.dot-pattern {
  background-image: radial-gradient(circle, #DADCE0 1px, transparent 1px);
  background-size: 24px 24px;
  opacity: 0.3;
}
```

---

## Animation Principles

### Timing
- **Micro-interactions:** 200-300ms ease
- **Card hovers:** 400-500ms ease
- **Page transitions:** 600-1000ms ease-out
- **Ambient loops:** 4-8s ease-in-out infinite

### Key Animations

| Name | Duration | Purpose |
|------|----------|---------|
| `float` | 6s | Floating cards, subtle movement |
| `morph` | 8s | Blob shape transformation |
| `pulse-glow` | 4s | Ambient glow breathing |
| `gradient-shift` | 8s | Gradient text animation |
| `fade-up` | 1s | Entry animation |
| `draw-line` | 3s | SVG path reveal |

### Mouse Interaction
- Background elements respond to cursor position
- Subtle parallax (10-30px movement)
- Smooth transition (0.4-0.6s ease-out)

---

## Component Patterns

### Buttons

**Primary CTA**
- Background: Gray 900 to #1a1a2e gradient
- Text: White
- Border-radius: 9999px (pill)
- Padding: 16px 32px
- Hover: Lift (-2px), shadow increase, shimmer effect

**Secondary**
- Background: Transparent
- Border: 1px solid Gray 200
- Text: Gray 800
- Hover: Border turns Accent Blue, text turns Accent Blue

### Cards
- Border-radius: 24px (large), 16px (medium), 12px (small)
- Always use glass effect on white backgrounds
- Hover: Slight lift (-4px), increased shadow, background opacity increase

### Tags/Badges
- Border-radius: 9999px
- Padding: 4px 12px
- Font-size: 12px
- Background: White or accent color at 10% opacity

### Icons
- Container: Rounded square (12-16px radius)
- Background: Glow color matching icon meaning
- Size: 32-56px container, icon 50% of container

---

## Layout Guidelines

### Spacing Scale
```
4px, 8px, 12px, 16px, 24px, 32px, 48px, 64px, 96px, 128px
```

### Container
- Max-width: 1280px
- Padding: 32px (mobile: 16px)

### Section Spacing
- Between major sections: 128px
- Between subsections: 64px
- Between elements: 24-32px

### Grid
- 12-column grid
- Gap: 32px
- Responsive breakpoints: 640px, 768px, 1024px, 1280px

---

## Dark Mode Considerations (Future)

When implementing dark mode:
- Invert base colors (Gray 900 becomes background)
- Increase glow intensity slightly
- Glass cards become `rgba(255, 255, 255, 0.05)`
- Maintain same accent colors but increase opacity
- Blobs become more visible

---

## Don'ts

- ❌ Harsh neon colors
- ❌ Sharp corners on cards
- ❌ Static, lifeless layouts
- ❌ Cluttered information density
- ❌ Generic fonts (Inter, Roboto, Arial)
- ❌ Purple gradients on white (overused AI aesthetic)
- ❌ Cookie-cutter SaaS patterns
- ❌ Animation for animation's sake

---

## Reference Links

- Gleb's Dribbble: https://dribbble.com/glebich
- Gleb's Behance: https://www.behance.net/gleb
- Milkinside Agency: https://milkinside.com
- CollectUI (Gleb's work): https://collectui.com/designers/glebich

---

*"Automata exists to amplify human connection — not replace it."*
