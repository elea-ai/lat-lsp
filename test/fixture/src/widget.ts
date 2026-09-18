// @lat: [[widget#Rendering]]

export function createWidget(label: string): string {
  return label.trim();
}

export function render(): string {
  return createWidget('standalone');
}

export class Panel {
  render(): string {
    return createWidget('panel');
  }
}
