// CSS modules
declare module '*.css' {
  const content: string;
  export default content;
}

// window.* functies die via window.X = function() {} worden gezet
interface Window {
  [key: string]: any;
}
