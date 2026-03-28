# Planning Document 17: Cockpit UI Redesign Specifications

## Overview
This document outlines the detailed design specifications for redesigning the SNAC-v2 cockpit UI to improve its visual appeal, usability, and overall user experience while maintaining all existing functionality.

## Current Issues Identified
1. **Visual Hierarchy**: Panels lack clear visual separation and hierarchy
2. **Spacing & Padding**: Inconsistent spacing makes the interface feel cramped
3. **Typography**: Limited typographic variety reduces readability
4. **Color Usage**: Over-reliance on accent colors without proper contrast
5. **Responsive Design**: Layout breaks down on smaller screens
6. **Component Styling**: Basic styling lacks modern UI/UX principles
7. **Information Density**: Too much information in limited space

## Design Goals
1. **Modern Aesthetic**: Implement a clean, professional dashboard look
2. **Improved Readability**: Better typography, spacing, and contrast
3. **Enhanced Usability**: Clear visual hierarchy and intuitive interactions
4. **Responsive Layout**: Adapt gracefully to different screen sizes
5. **Visual Feedback**: Better state indication and loading states
6. **Consistent Styling**: Unified design language across all components
7. **Performance**: Maintain or improve rendering performance

## Detailed Design Specifications

### 1. Layout & Grid System
- **Container**: Max-width 1600px with fluid padding on sides
- **Grid**: CSS Grid with flexible columns (3-column on desktop, 1-column on mobile)
- **Gaps**: Consistent 24px gap between panels
- **Breakpoints**: 
  - Desktop (>1200px): 3-column layout
  - Tablet (768-1200px): 2-column layout
  - Mobile (<768px): 1-column layout

### 2. Color Scheme Refinement
**Primary Palette**:
- Background: #0f172a (darker slate for better contrast)
- Secondary Background: #1e293b (slightly lighter for panels)
- Tertiary Background: #334155 (for headers and interactive elements)
- Accent Blue: #3b82f6 (more professional than current)
- Accent Green: #10b981 (success/positive states)
- Accent Yellow: #f59e0b (warnings/alerts)
- Accent Red: #ef4444 (errors/critical states)
- Accent Purple: #8b5cf6 (secondary actions/info)
- Text Primary: #f8fafc (near white for maximum contrast)
- Text Secondary: #94a3b8 (muted for secondary text)
- Border: #475569 (subtle separation)

### 3. Typography System
- **Font Family**: System UI stack with fallback to sans-serif
- **Heading Levels**:
  - H1 (App Title): 2rem, font-weight 700, letter-spacing -0.5%
  - H2 (Panel Headers): 1.25rem, font-weight 600, text-transform uppercase, letter-spacing 0.05em
  - H3 (Section Titles): 1.125rem, font-weight 500
- **Body Text**: 0.875rem, line-height 1.6
- **Small Text**: 0.75rem (timestamps, labels, etc.)
- **Code/Numbers**: Monospace font for technical data

### 4. Component Specifications

#### Header
- Height: 80px
- Background: Linear gradient from tertiary to secondary background
- Display: Flex with justify-content: space-between
- App Title: Gradient text effect (blue to purple)
- Status Indicator: Pill-shaped badge with subtle animation

#### Controls Section
- **Task Input**:
  - Input: Full width, padded, rounded, with focus ring
  - Button: Primary accent color, hover transform, disabled state styling
  - Gap: 12px between input and button
- **Ingest Input**:
  - Textarea: Minimum 3 rows, resizable, same styling as input
  - Button: Same as task input button
- Layout: Grid with 1fr 1fr columns, gap 16px

#### Panels (Shared Styles)
- Background: Secondary background with subtle border
- Border Radius: 12px (softer than current 8px)
- Box Shadow: Subtle elevation (0 4px 6px -1px rgba(0,0,0,0.1))
- Overflow: Hidden
- Transition: All 0.3s ease for hover effects
- Header:
  - Background: Tertiary background
  - Padding: 16px 20px
  - Border Bottom: 1px solid border color
  - Display: Flex, align-items: center, justify-content: space-between
  - H2: Font size 1.125rem, font-weight 600
  - Badge: Pill shape, appropriate accent color based on state
- Content:
  - Padding: 20px
  - Min-height: 280px (consistent panel height)

#### Memory Timeline Panel
- Timeline Items:
  - Background: Tertiary background
  - Margin: 8px 0
  - Padding: 14px
  - Border Radius: 8px
  - Border Left: 3px solid accent blue (indicates activity type)
  - Display: Grid, grid-template-columns: 60px 1fr 80px, gap 12px
  - Time: Monospace, text-secondary, font-size 0.75rem
  - Type: Font-weight 500, accent blue, text-transform uppercase
  - Detail: Text-primary, overflow hidden, text-overflow ellipsis
  - Hover: Lift effect (translateY(-2px)), enhanced shadow
- Loading/Empty States:
  - Centered flex container
  - Icon + text combination
  - Subtle animation for loading

#### Node Visualizer Panel
- Node Graph:
  - Display: Flex, flex-direction: column, gap 12px
  - Node Row:
    - Display: Flex, align-items: center, gap 10px
    - Node:
      - Display: Flex, align-items: center, gap 8px
      - Padding: 12px 16px
      - Background: Tertiary background
      - Border: 2px solid border color
      - Border Radius: 8px
      - Min-width: 130px
      - Transition: All 0.2s ease
      - Active State: Border color accent blue, background rgba(59, 130, 246, 0.05)
      - Completed State: Border color accent green, background rgba(16, 185, 129, 0.05)
      - Icon: Font-size 1.1rem, color based on status
      - Label: Font-weight 500, flex 1
    - Connector:
      - Font-size: 1.2rem
      - Color: Border color
      - Active: Accent blue color
      - Transition: Color 0.2s ease
- Current Task:
  - Background: Tertiary background
  - Padding: 14px
  - Border Radius: 8px
  - Font-size: 0.875rem
  - Color: Text-secondary
- Steps List:
  - Display: Flex, flex-direction: column, gap 8px
  - Step Item:
    - Display: Flex, gap 10px
    - Padding: 10px
    - Background: Tertiary background
    - Border Radius: 6px
    - Font-size: 0.875rem
    - Step Num: Width 24px, color text-secondary
    - Step Type: Width 50px, color accent purple, font-weight 500
    - Step Input: Flex 1, color text-secondary, font-family monospace
    - Step Arrow: Color accent blue
    - Step Result: Color accent green, font-weight 500

#### Token Monitor Panel
- Cost Display:
  - Display: Flex, justify-content: space-between, margin-bottom 20px
  - Cost Total/Current:
    - Display: Flex, flex-direction: column, gap 4px
    - Cost Label: Font-size 0.75rem, color text-secondary
    - Cost Value: Font-size 1.875rem, font-weight 700, font-family monospace, color text-primary
- Budget Bar:
  - Height: 10px
  - Background: Border color
  - Border Radius: 5px
  - Overflow: Hidden
  - Margin-bottom 8px
  - Budget Fill:
    - Height: 100%
    - Border Radius: 5px
    - Transition: Width 0.4s ease
    - Success: Accent green
    - Warning: Accent yellow
    - Danger: Accent red
- Budget Labels:
  - Display: Flex, justify-content: space-between
  - Font-size: 0.75rem
  - Color: text-secondary
  - Warning: Accent yellow color
- Session Costs:
  - Margin-top: 20px
  - Padding-top: 20px
  - Border-top: 1px solid border color
  - Session Item:
    - Display: Flex, justify-content: space-between, padding 6px 0
    - Font-size: 0.825rem
    - Font-family: monospace
    - Session ID: Color text-secondary
    - Session Cost: Color accent green

### 5. Interactive States & Feedback
- **Hover States**: Subtle elevation increase, color shifts
- **Focus States**: Outline-none, ring-2 ring-offset-2 ring-accent-blue
- **Active/Pressed States**: Scale(0.98) transform
- **Disabled States**: Opacity 0.5, cursor not-allowed
- **Loading States**: Skeleton screens or spinner animations
- **Success/Error States**: Appropriate accent colors with icons

### 6. Animations & Transitions
- **Panel Entrance**: Fade up + scale (0.95 to 1) over 0.4s
- **Button Hover**: Scale(1.02) + color shift
- **Node Activation**: Pulse animation on active nodes
- **Timeline Items**: Staggered fade-in on load
- **Cost Updates**: Smooth number transition
- **All Transitions**: Cubic-bezier(0.4, 0, 0.2, 1) for natural feel

### 7. Responsive Design Breakpoints
- **Desktop** (>1200px): 3-column grid, full sidebar if needed
- **Laptop** (992-1200px): 3-column grid with reduced panel widths
- **Tablet** (768-991px): 2-column grid, panels stack vertically
- **Mobile** (<768px): 1-column grid, full-width panels
- **Controls**: Stack vertically on mobile, gap 12px
- **Typography**: Scale down slightly on smaller screens
- **Padding**: Reduced on mobile (16px vs 20px desktop)

### 8. Accessibility Considerations
- **Color Contrast**: All text meets WCAG AA standards
- **Focus Visibility**: Clear focus indicators on all interactive elements
- **Screen Reader**: Proper semantic HTML and ARIA labels where needed
- **Touch Targets**: Minimum 44x44px for interactive elements
- **Reduced Motion**: Respect prefers-reduced-motion media query
- **Font Scaling**: Support for user font size preferences

### 9. Implementation Approach
1. **Phase 1**: Update CSS variables and base styles in index.css
2. **Phase 2**: Refactor App.css with new component styles
3. **Phase 3**: Update App.jsx with improved class names and structure
4. **Phase 4**: Add responsive breakpoints and media queries
5. **Phase 5**: Implement animations and interactive states
6. **Phase 6**: Test accessibility and performance

### 10. CSS Variables Update (index.css)
```css
:root {
  /* Backgrounds */
  --bg-primary: #0f172a;
  --bg-secondary: #1e293b;
  --bg-tertiary: #334155;
  
  /* Borders */
  --border: #475569;
  
  /* Text */
  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  
  /* Accents */
  --accent-blue: #3b82f6;
  --accent-green: #10b981;
  --accent-yellow: #f59e0b;
  --accent-red: #ef4444;
  --accent-purple: #8b5cf6;
  
  /* Shadows */
  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
  
  /* Radius */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 12px;
  
  /* Transitions */
  --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-medium: 300ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-slow: 500ms cubic-bezier(0.4, 0, 0.2, 1);
}
```

### 11. Performance Considerations
- **CSS Optimization**: Minimize repaints, use transform/opacity for animations
- **Rendering**: Use content-visibility: auto for off-screen panels (future)
- **Bundle Size**: Keep CSS minimal, avoid unnecessary overrides
- **Rendering**: Leverage React.memo where appropriate for panel components
- **Event Handling**: Debounce resize listeners for responsive adjustments

## Validation Criteria
1. Visual appeal improved significantly over current design
2. All existing functionality preserved
3. Responsive layout works across all breakpoints
4. Accessibility standards met (WCAG AA)
5. Performance maintained or improved
6. Consistent design language applied throughout
7. Clear visual hierarchy and information architecture
8. Professional, dashboard-appropriate aesthetic

## Files to Modify
1. `ui/src/index.css` - Update CSS variables and base styles
2. `ui/src/App.css` - Replace with new component styles
3. `ui/src/App.jsx` - Update class names and potentially structure
4. `plans/17-cockpit-redesign-specs.md` - This document

## Next Steps
1. Review and approve these design specifications
2. Switch to Code mode to implement the CSS changes
3. Implement the updated styles in index.css and App.css
4. Update App.jsx with new class names as needed
5. Test across different screen sizes and devices
6. Validate accessibility and performance
7. Gather feedback and iterate as needed