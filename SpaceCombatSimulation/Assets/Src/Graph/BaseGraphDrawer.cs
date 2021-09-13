using Assets.Src.Evolution;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.Graph
{
    public abstract class BaseGraphDrawer: MonoBehaviour
    {
        public Texture BorderTexture;
        public Texture PointTexture;
        public Texture LineTexture;

        public Rect GraphRect = new Rect(50, 50, 450, 150);

        public EvolutionController EvolutionController;

        public KeyCode DrawGraphKey = KeyCode.G;

        protected IGraph _graph;

        protected virtual bool HasCalculatedGraph
        {
            get
            {
                return _graph != null;
            }
        }

        private bool _drawGraph = false;
        private float _lastToggleTime = 0;

        internal virtual void DrawGraph()
        {
            if (_graph != null)
            {
                _graph.DrawGraph();
            }
        }

        public void Start()
        {
            if (EvolutionController == null)
            {
                Debug.Log($"EvolutionController not set - trying to get it from {this}.");
                EvolutionController = GetComponent<EvolutionController>();
                if (EvolutionController == null)
                {
                    Debug.LogError($"EvolutionController was not set initially, and couldn't be found in {this}.");
                    enabled = false;
                    return;
                }
                return;
            }
        }

        public void OnGUI()
        {
            if (Input.GetKeyUp(DrawGraphKey))
            {
                if (!HasCalculatedGraph)
                {
                    _drawGraph = true;
                    PrepareGraph();
                } else if (Time.time > _lastToggleTime + 0.1)
                {
                    _drawGraph = !_drawGraph;
                }
                _lastToggleTime = Time.time;
            }
            if (_drawGraph)
            {
                DrawGraph();
            }
        }

        internal abstract void PrepareGraph();

        protected Dictionary<int, Generation> ReadGenerations()
        {
            var generations = Enumerable.Range(0, EvolutionController.GenerationNumber + 1)
                   .ToDictionary(i => i, i => EvolutionController.DbHandler.ReadGeneration(EvolutionController.DatabaseId, i));
            return generations;
        }
    }
}
