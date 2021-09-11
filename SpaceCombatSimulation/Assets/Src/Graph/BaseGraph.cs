using UnityEngine;

namespace Assets.Src.Graph
{
    public abstract class BaseGraph : I2DBounded, IGraph
    {
        public abstract void DrawGraph();
        public abstract Bounds2D Get2DBounds();

        protected readonly Rect _location;
        protected readonly Texture _backgroundTexture;
        protected readonly Texture _lineTexture;
        protected readonly Texture _pointTexture;

        public BaseGraph(Rect location, Texture backgroundTexture, Texture pointTexture, Texture lineTexture)
        {
            _location = location;
            _backgroundTexture = backgroundTexture;
            _lineTexture = lineTexture;
            _pointTexture = pointTexture;
        }

        protected void DrawBackground()
        {
            if(_backgroundTexture != null)
            {
                GUI.DrawTexture(_location, _backgroundTexture);
            }
        }
    }
}
