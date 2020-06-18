/* Visable function generator */
const _visable = (type: string) => (props: VisableProps) =>
  `display: ${props.show ? type : 'none'} `;
/* Using in Flex show / hide */
export const flexVisiable = _visable('flex');
/* Using in Block show / hide */
export const blockVisiable = _visable('block');
/* Using in InlineBlock show / hide */
export const inlineVisiable = _visable('inline-block');

/* Type of visable function */
export interface VisableProps {
  show?: boolean;
}
