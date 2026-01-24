/**
 * Email HTML Sanitizer
 * Safely sanitizes HTML email content to prevent XSS attacks
 * while preserving formatting and images
 */

/**
 * Sanitizes HTML email content by:
 * - Removing script tags and event handlers
 * - Constraining images to container width
 * - Preserving safe HTML formatting
 */
export function sanitizeEmailHtml(html: string): string {
  if (!html) return '';

  // Create a temporary DOM element to parse HTML
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;

  // Remove dangerous elements and attributes
  const dangerousTags = ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button'];
  dangerousTags.forEach(tag => {
    const elements = tempDiv.querySelectorAll(tag);
    elements.forEach(el => el.remove());
  });

  // Remove dangerous attributes from all elements
  const allElements = tempDiv.querySelectorAll('*');
  allElements.forEach(el => {
    // Remove event handlers and dangerous attributes
    const dangerousAttrs = [
      'onclick', 'onerror', 'onload', 'onmouseover', 'onfocus', 'onblur',
      'onchange', 'onsubmit', 'onkeydown', 'onkeyup', 'onkeypress',
      'javascript:', 'data:text/html'
    ];

    Array.from(el.attributes).forEach(attr => {
      const attrName = attr.name.toLowerCase();
      const attrValue = attr.value.toLowerCase();

      // Remove event handlers
      if (attrName.startsWith('on')) {
        el.removeAttribute(attr.name);
      }

      // Remove dangerous href/src values
      if ((attrName === 'href' || attrName === 'src') && 
          dangerousAttrs.some(danger => attrValue.includes(danger))) {
        el.removeAttribute(attr.name);
      }

      // Remove style attributes that could be dangerous (keep safe ones)
      // IMPORTANT: Remove color and background-color to allow theme colors
      if (attrName === 'style') {
        const safeStyles = attr.value
          .split(';')
          .filter(style => {
            const prop = style.split(':')[0].trim().toLowerCase();
            // Exclude color and background-color - we'll use theme colors instead
            if (prop === 'color' || prop === 'background-color' || prop === 'background') {
              return false;
            }
            // Allow safe CSS properties (layout and typography only)
            const safeProps = [
              'font-size', 'font-family', 'font-weight', 'font-style',
              'text-align', 'text-decoration', 'text-transform',
              'padding', 'margin', 'border', 'border-color', 'border-width', 'border-style',
              'width', 'max-width', 'min-width',
              'height', 'max-height', 'min-height', 'line-height',
              'display', 'position', 'top', 'left', 'right', 'bottom',
              'float', 'clear', 'vertical-align', 'text-indent',
              'letter-spacing', 'word-spacing', 'white-space', 'word-break',
              'list-style', 'list-style-type', 'list-style-position',
              'border-collapse', 'border-spacing', 'caption-side',
              'empty-cells', 'table-layout', 'overflow', 'overflow-x', 'overflow-y'
            ];
            return safeProps.some(safe => prop.includes(safe));
          })
          .join(';');
        if (safeStyles) {
          el.setAttribute('style', safeStyles);
        } else {
          el.removeAttribute('style');
        }
      }
    });

    // Constrain images to container width
    if (el.tagName.toLowerCase() === 'img') {
      el.setAttribute('style', 'max-width: 100%; height: auto; display: block;');
      el.removeAttribute('width');
      el.removeAttribute('height');
    }
  });

  return tempDiv.innerHTML;
}

/**
 * Formats plain text email content with proper line breaks and spacing
 */
export function formatPlainTextEmail(text: string): string {
  if (!text) return '';

  // Preserve line breaks and normalize whitespace
  return text
    .replace(/\r\n/g, '\n')  // Normalize line endings
    .replace(/\r/g, '\n')    // Handle old Mac line endings
    .replace(/\n{3,}/g, '\n\n')  // Limit consecutive line breaks
    .trim();
}
