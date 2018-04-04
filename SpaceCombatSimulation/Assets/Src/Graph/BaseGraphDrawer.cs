using Assets.Src.Evolution;
using UnityEngine;

namespace Assets.Src.Graph
{
    public abstract class BaseGraphDrawer: MonoBehaviour
    {
        public Texture BorderTexture;
        public Texture PointTexture;

        public Rect GraphRect = new Rect(50, 50, 450, 150);

        public BaseEvolutionController EvolutionControler;

        public KeyCode DrawGraphKey = KeyCode.G;

        protected IGraph _graph;

        protected virtual bool _hasCalculatedGraph
        {
            get
            {
                return _graph != null;
            }
        }

        internal virtual void DrawGraph()
        {
            if (_graph != null)
            {
                _graph.DrawGraph();
            }
        }

        public void OnGUI()
        {
            if (Input.GetKeyUp(DrawGraphKey) && !_hasCalculatedGraph)
            {
                PrepareGraph();
            }
            if (_hasCalculatedGraph)
            {
                DrawGraph();
            }
        }
        
        internal abstract void PrepareGraph();
    }
}
