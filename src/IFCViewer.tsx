import React, { useState, useEffect, useRef } from 'react';
import * as BABYLON from '@babylonjs/core';
import * as WebIFC from 'web-ifc';
import './IFCViewer.css'

const IFCViewer = () => {
  const canvasRef = useRef(null);
  const [scene, setScene] = useState<BABYLON.Scene | null>(null);
  const ifcapi = new WebIFC.IfcAPI();
  ifcapi.SetWasmPath("/");

  const isAnimation = true;

  // 初期表示
  useEffect(() => {
    const canvas = canvasRef.current;
    const engine = new BABYLON.Engine(canvas, true);
    const scene = new BABYLON.Scene(engine);
    setScene(scene)

    const camera = new BABYLON.ArcRotateCamera("Camera", -Math.PI / 2, Math.PI / 2, 20, BABYLON.Vector3.Zero(), scene);
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 2
    const light1 = new BABYLON.HemisphericLight("light1", new BABYLON.Vector3(0, -100, 0), scene);
    light1

    // XYZ 軸
    const axisSize = 15;
    const xColor = new BABYLON.Color3(1, 0, 0);
    const yColor = new BABYLON.Color3(0, 1, 0);
    const zColor = new BABYLON.Color3(0, 0, 1);

    // X軸
    const xLine = BABYLON.MeshBuilder.CreateLines("xAxis", { points: [BABYLON.Vector3.Zero(), new BABYLON.Vector3(axisSize, 0, 0)] }, scene);
    xLine.color = xColor;

    // Y軸
    const yLine = BABYLON.MeshBuilder.CreateLines("yAxis", { points: [BABYLON.Vector3.Zero(), new BABYLON.Vector3(0, axisSize, 0)] }, scene);
    yLine.color = yColor;

    // Z軸
    const zLine = BABYLON.MeshBuilder.CreateLines("zAxis", { points: [BABYLON.Vector3.Zero(), new BABYLON.Vector3(0, 0, axisSize)] }, scene);
    zLine.color = zColor;

    engine.runRenderLoop(() => {
      scene.render();
    });

    window.addEventListener("resize", () => {
      engine.resize();
    });

    return () => {
      engine.dispose();
      scene.dispose();
    }
  }, []);

  // ファイル選択時の処理
  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = (event.target.files as FileList)[0];
    if (file) {
      loadIFCFile(file);
    }
  }

  // IFCファイルの読み込み
  function loadIFCFile(file: File) {
    const reader = new FileReader();
    reader.onload = async (event) => {
      const buffer = new Uint8Array(event.target?.result as ArrayBuffer)
      await ifcapi.Init();
      const modelID = ifcapi.OpenModel(buffer)

      if(isAnimation){
        // アニメーションさせる場合
        createMeshAnimation(modelID)
      } else {
        createMesh(modelID)
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // メッシュの作成
  function createMesh(modelID: number) {
    ifcapi.StreamAllMeshes(modelID, (mesh) => loadMesh(modelID, mesh))
  }

  // アニメーションをさせてメッシュを作成
  function createMeshAnimation(modelID: number) {
    if (scene === null) return

    // すべてのメッシュを同期取得
    let meshData = []
    const meshes = ifcapi.LoadAllGeometry(modelID)
    for (let i = 0; i < meshes.size(); i++) {
      const mesh = meshes.get(i)
      for(const geometry of loadGeometry(modelID, mesh)){
        meshData.push(geometry)
      }
    }

    // 表示順のソート設定
    meshData = meshData.map(v => {
      let posy = 100000
      for (let i = 0; i < v.vertexData.positions.length; i += 3) {
        posy = Math.min(posy, v.vertexData.positions[i + 2])
      }
      return { ...v, sortKey: v.flatTransformation[13] + posy }
    })
    meshData.sort((a, b) => a.sortKey - b.sortKey)

    // 10秒かけて表示されるように
    const msec = 10000 / meshData.length
    meshData.forEach((v, i) => {
      setTimeout(() => {
        ifc2babylonMesh(scene, v.vertexData, v.flatTransformation, v.color)
      }, msec * i);
    })
  }

  // IFCからメッシュの読み込み
  function loadMesh(modelID: number, mesh: WebIFC.FlatMesh) {
    if (scene === null) return;

    // IFCからBabylon.jsのメッシュを構築
    for(const geometry of loadGeometry(modelID, mesh)){
      ifc2babylonMesh(
        scene,
        geometry.vertexData,
        geometry.flatTransformation,
        geometry.color
      )
    }
  }

  // IFCからメッシュ情報を取得するジェネレータ
  function* loadGeometry(modelID: number, mesh: WebIFC.FlatMesh) {
    const placedGeometries = mesh.geometries;
    const size = placedGeometries.size();
    for (let i = 0; i < size; i++) {
      const placedGeometry = placedGeometries.get(i)
      const geometry = ifcapi.GetGeometry(modelID, placedGeometry.geometryExpressID);
      // 6つで一組のデータ： x, y, z, normalx, normaly, normalz
      const verts = ifcapi.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
      // 3つで一組のデータ：頂点index 1, 2, 3
      const indices = ifcapi.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());

      // 頂点の座標と法線を分離
      const positions = [];
      const normals = [];
      for (let i = 0; i < verts.length; i += 6) {
        positions.push(verts[i], verts[i + 1], verts[i + 2]);
        normals.push(verts[i + 3], verts[i + 4], verts[i + 5]);
      }

      const vertexData = {
        positions: positions,
        normals: normals,
        indices: Array.from(indices),
      }

      // 頂点と変形行列と色情報を返す
      const geometoryData = {
        vertexData: vertexData,
        flatTransformation: placedGeometry.flatTransformation,
        color: placedGeometry.color,
      };

      yield geometoryData;
    }
  }

  // IFCの形状情報からBabylon.jsのメッシュを作成
  function ifc2babylonMesh(
    scene: BABYLON.Scene,
    vertexData: { positions: number[], normals: number[], indices: number[] },
    flatTransformation: number[],
    color: { x: number, y: number, z: number, w: number },
  ) {
    // メッシュ作成
    const mesh = createMeshFromData(scene, vertexData)

    // メッシュの移動・変形
    const transformationMatrix = BABYLON.Matrix.FromArray(flatTransformation);
    mesh.setPivotMatrix(transformationMatrix, false);

    // 奥行きZの左手系に
    mesh.scaling.z *= -1;

    // 面を反転
    mesh.flipFaces(true);

    // 色設定
    const { x, y, z, w } = color
    const material = new BABYLON.StandardMaterial("material", scene);
    material.diffuseColor = new BABYLON.Color3(x, y, z);
    material.alpha = w
    material.backFaceCulling = false;
    mesh.material = material;
  }

  // 頂点データ化からメッシュ作成
  function createMeshFromData(scene: BABYLON.Scene, vertexData: { positions: number[], normals: number[], indices: number[] }) {
    const mesh = new BABYLON.Mesh("mesh", scene);
    const vertexDataForBabylon = new BABYLON.VertexData();
    vertexDataForBabylon.positions = vertexData.positions;
    vertexDataForBabylon.normals = vertexData.normals;
    vertexDataForBabylon.indices = vertexData.indices;
    vertexDataForBabylon.applyToMesh(mesh);
    return mesh;
  }

  return (
    <>
      <input type="file" onChange={handleFileChange} className="fileInput" />
      <canvas className="fullScreenCanvas" ref={canvasRef} />
    </>
  )
}

export default IFCViewer;
