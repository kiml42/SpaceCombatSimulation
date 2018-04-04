using UnityEngine;

namespace Assets.Src.Graph
{
    public abstract class BaseGraph : I2DBounded, IGraph
    {
        public abstract void DrawGraph();
        public abstract Bounds2D Get2DBounds();

        protected readonly Rect _location;
        protected readonly Texture _backgroundTexture;

        public BaseGraph(Rect location, Texture backgroundTexture)
        {
            _location = location;
            _backgroundTexture = backgroundTexture;
        }

        protected void DrawBackground()
        {
            GUI.DrawTexture(_location, _backgroundTexture, ScaleMode.StretchToFill, true, 0.5f, Color.white, 5, 5);
        }
    }
}
