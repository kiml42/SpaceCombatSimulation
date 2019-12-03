using Assets.Src.Evolution;
using UnityEngine;

namespace Assets.Src.Graph
{
    public abstract class BaseGraphDrawer: MonoBehaviour
    {
        public Texture BorderTexture;
        public Texture PointTexture;
        public Texture LineTexture;

        public Rect GraphRect = new Rect(50, 50, 450, 150);

        public EvolutionController EvolutionControler;

        public KeyCode DrawGraphKey = KeyCode.G;

        protected IGraph _graph;

        protected virtual bool HasCalculatedGraph
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
            if (Input.GetKeyUp(DrawGraphKey) && !HasCalculatedGraph)
            {
                PrepareGraph();
            }
            if (HasCalculatedGraph)
            {
                DrawGraph();
            }
        }
        
        internal abstract void PrepareGraph();
    }
}
