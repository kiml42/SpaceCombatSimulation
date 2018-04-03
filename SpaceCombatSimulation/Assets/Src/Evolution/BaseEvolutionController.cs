using Assets.Src.Database;
using Assets.Src.Graph;
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
        public Texture BorderTexture;
        public Texture PointTexture;

        protected IEnumerable<Transform> ListShips()
        {
            return GameObject.FindGameObjectsWithTag(ShipConfig.SpaceShipTag)
                    .Where(s =>
                        s.transform.parent != null &&
                        s.transform.parent.GetComponent<Rigidbody>() != null
                    ).Select(s => s.transform.parent);
        }

        public abstract GeneralDatabaseHandler DbHandler { get; }

        protected abstract BaseEvolutionConfig _baseConfig { get; }

        public int GenerationNumber { get { return _baseConfig.GenerationNumber; } }
    }
}
