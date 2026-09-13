// cytoscape-fcose는 자체 타입 선언을 배포하지 않는다(cytoscape-dagre와
// 달리 .d.ts가 패키지에 없음, node_modules 확인 완료) - 이 파일은 그
// 패키지 자신의 타입 선언이 아니라 "cytoscape-fcose"라는 모듈 지정자에
// 대한 앰비언트 선언이라, 반드시 declare module 블록 안에 둬야 한다
// (최상위에 import/export를 쓰면 이 파일 자체가 별개의 모듈로 취급돼
// "cytoscape-fcose" 지정자에는 아무 선언도 안 붙는다).
declare module "cytoscape-fcose" {
  import cytoscape = require("cytoscape");

  const cytoscapeFcose: cytoscape.Ext;
  export = cytoscapeFcose;
}
