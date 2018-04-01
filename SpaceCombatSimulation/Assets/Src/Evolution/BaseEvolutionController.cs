using Assets.Src.Database;
using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.Evolution
{
    public abstract class BaseEvolutionController : MonoBehaviour
    {
        public int DatabaseId;

        public EvolutionShipConfig ShipConfig;
        protected EvolutionMutationWrapper _mutationControl = new EvolutionMutationWrapper();
        protected EvolutionMatchController _matchControl;

        protected IEnumerable<Transform> ListShips()
        {
            return GameObject.FindGameObjectsWithTag(ShipConfig.SpaceShipTag)
                    .Where(s =>
                        s.transform.parent != null &&
                        s.transform.parent.GetComponent<Rigidbody>() != null
                    ).Select(s => s.transform.parent);
        }

        protected abstract GeneralDatabaseHandler _dBHandler { get; }

        public void OnGUI()
        {
            if (Input.GetKeyUp(KeyCode.G))
            {
                Debug.Log("Drawing graph");
                DrawGraph();
            }
        }

        private void DrawGraph()
        {
            var mousePos = Input.mousePosition;
            Vector3 startVertex = Vector3.zero;
            GL.PushMatrix();
            GL.LoadOrtho();
            GL.Begin(GL.LINES);
            GL.Color(Color.white);
            GL.Vertex(startVertex);
            GL.Vertex(new Vector3(500, 500, 500));
            GL.End();
            GL.PopMatrix();
        }
    }
}
