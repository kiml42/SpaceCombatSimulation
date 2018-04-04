using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.Graph
{
    public class StackedBarGraph : BaseGraph
    {
        public List<GraphLine> Lines;

        public StackedBarGraph(Rect location, Texture backgroundTexture, params GraphLine[] lines) : base(location, backgroundTexture)
        {
            Lines = lines.ToList();
        }

        public override void DrawGraph()
        {
            DrawBackground();

            var scale = Get2DBounds();

            foreach( var line in Lines)
            {
                line.DrawPoints(scale, _location);
            }

            var zeroZeroUiPoint = new GraphPoint(0, 0).ToUiPoint(scale, _location);
            GUI.Label(new Rect(zeroZeroUiPoint.x, zeroZeroUiPoint.y, 40, 40), "0");

            if (Lines.Any())
            {
                var line = Lines.First();
                foreach (var point in line.Points)
                {
                    var uiPoint = point.ToUiPoint(scale, _location);

                    GUI.Label(new Rect(uiPoint.x, _location.max.y, 40, 40), point.X.ToString());
                }
            }
        }

        public override Bounds2D Get2DBounds()
        {
            if (Lines.Any())
            {
                return new Bounds2D(
                    Lines.Min(l => l.Get2DBounds().MinX),
                    Lines.Min(l => l.Get2DBounds().MinY),
                    Lines.Max(l => l.Get2DBounds().MaxX),
                    Lines.Max(l => l.Get2DBounds().MaxY)
                    );
            }
            return Bounds2D.Default;
        }
    }
}
