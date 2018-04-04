using UnityEngine;

namespace Assets.Src.Graph
{
    public interface IGraph
    {
        void DrawGraph(Rect location, Texture boarderTexture, Texture pointTexture);
    }
}
