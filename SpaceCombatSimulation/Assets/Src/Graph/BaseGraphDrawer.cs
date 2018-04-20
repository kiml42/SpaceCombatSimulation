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
        public int GenerationsToShow = 20;

        public Rect GraphRect = new Rect(50, 50, 450, 150);

        public BaseEvolutionController EvolutionControler;

        public KeyCode DrawGraphKey = KeyCode.G;
        public KeyCode CancelGraphKey = KeyCode.Backspace;

        protected IGraph _graph;
        private bool _graphOn;

        protected virtual bool _hasCalculatedGraph
        {
            get
            {
                return _graph != null;
            }
        }

        internal virtual void DrawGraph()
        {
            if (_graph != null && _graphOn)
            {
                _graph.DrawGraph();
            }
        }

        public void OnGUI()
        {
            _graphOn = (_graphOn || Input.GetKeyUp(DrawGraphKey)) && !Input.GetKeyUp(CancelGraphKey);
            if (_graphOn)
            {
                if (!_hasCalculatedGraph)
                {
                    _graphOn = true;
                    PrepareGraph();
                }
                if (_hasCalculatedGraph)
                {
                    DrawGraph();
                }
            }
        }
        
        internal abstract void PrepareGraph();

        protected IDictionary<int, BaseGeneration> ListGenerations()
        {
            var start = Mathf.Max(0, EvolutionControler.GenerationNumber - GenerationsToShow);
            var generations = Enumerable.Range(start, EvolutionControler.GenerationNumber)
                .ToDictionary(i => i, i => EvolutionControler.DbHandler.ReadBaseGeneration(EvolutionControler.DatabaseId, i));
            return generations;
        }
    }
}
