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

        protected abstract bool _hasCalculatedGraph { get; }

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

        internal abstract void DrawGraph();
        internal abstract void PrepareGraph();
    }
}
