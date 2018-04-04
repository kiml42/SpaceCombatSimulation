using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.Graph
{
    public class GraphLine : I2DBounded
    {
        public string Name;
        public List<GraphPoint> Points = new List<GraphPoint>();
        public Color Colour = Random.ColorHSV();

        public void Add(GraphPoint point)
        {
            Points.Add(point);
        }

        public void Add(float x, float y)
        {
            Points.Add(new GraphPoint(x,y));
        }

        public Bounds2D Get2DBounds()
        {
            if (Points.Any())
            {
                return new Bounds2D(
                    Points.Min(p => p.X),
                    Points.Min(p => p.Y),
                    Points.Max(p => p.X),
                    Points.Max(p => p.Y)
                    );
            }
            return Bounds2D.Default;
        }

        internal void DrawPoints(Bounds2D scale, Rect location, Texture pointTexture, float pointSize = 10)
        {
            foreach(var point in Points)
            {
                point.DrawPoint(scale, location, pointTexture, pointSize, Colour);
            }
        }
    }
}
