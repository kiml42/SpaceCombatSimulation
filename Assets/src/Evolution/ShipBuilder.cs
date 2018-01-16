using Assets.Src.Evolution;
using Assets.Src.Interfaces;
using Assets.Src.ModuleSystem;
using Assets.Src.ObjectManagement;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.src.Evolution
{
    public class ShipBuilder : IKnowsEnemyTags
    {

        #region EnemyTags
        public void AddEnemyTag(string newTag)
        {
            var tags = EnemyTags.ToList();
            tags.Add(newTag);
            EnemyTags = tags.Distinct().ToList();
        }

        public void SetEnemyTags(List<string> allEnemyTags)
        {
            EnemyTags = allEnemyTags;
        }

        public List<string> GetEnemyTags()
        {
            return EnemyTags;
        }

        public List<string> EnemyTags;
        #endregion
        
        public float MaxShootAngle = 180;
        public float DefaultShootAngleProportion = 0.5f;
        public float MaxLocationAimWeighting = 2;
        public float DefaultLocationAimWeightingProportion = 0.5f;
        public float MaxSlowdownWeighting = 70;
        public float DefaultSlowdownWeightingProportion = 0.5f;
        public float MaxTangentialVelosityWeighting = 70;
        public float DefaultTangentialVelosityWeightingProportion = 0.5f;
        public float MaxMaxAndMinRange = 1000;
        public float DefaultMaxAndMinRangeProportion = 0.1f;
        public float MaxVelociyTollerance = 100;
        public float DefaultVelociyTolleranceProportion = 0.1f;
        public float MaxAngularDragForTorquers = 1;
        public float DefaultAngularDragForTorquersProportion = 0.2f;

        public Vector3 InitialVelocity = Vector3.zero;
        
        private GenomeWrapper _genome;
        public int GeneLength = 1;

        private ModuleList _moduleList;
        
        private Transform _shipToBuildOn;
        private TestCubeChecker _testCubePrefab;

        public bool OverrideColour;
        public Color ColourOverride;
        private Color _colour;
        
        public ShipBuilder(GenomeWrapper genomeWrapper, Transform shipToBuildOn, ModuleList moduleList, TestCubeChecker testCubePrefab = null)
        {
            _shipToBuildOn = shipToBuildOn;
            if (_shipToBuildOn == null)
            {
                throw new ArgumentNullException("shipToBuildOn", "shipToBuildOn must be a valid Transform.");
            }
            _moduleList = moduleList;
            if(_moduleList == null)
            {
                throw new ArgumentNullException("moduleList", "moduleList must be a valid ModuleList objet.");
            }
            _genome = genomeWrapper;
            _testCubePrefab = testCubePrefab;
        }

        public GenomeWrapper BuildShip(bool ConfigureConstants = true, bool setName = true, bool setColour = true)
        {
            //Debug.Log("Building " + _genome);
            if (setColour)
            {
                if(OverrideColour)
                {
                    _colour = ColourOverride;
                } else
                {
                    _colour = _genome.GetColorForGenome();
                }
                _shipToBuildOn.SetColor(_colour);
            }

            if (setName)
                _shipToBuildOn.name = _genome.GetName();
            Debug.Log("Spawning modules on " + _shipToBuildOn.name);

            _usedLocations.Add(_shipToBuildOn.position);
            _genome = SpawnModules(_shipToBuildOn);

            if(ConfigureConstants)
                ConfigureShip();

            return _genome;
        }

        [Obsolete("This shouldn't be setable")]
        public void SetGenome(GenomeWrapper genomeWrapper)
        {
            _genome = genomeWrapper;
        }

        private GenomeWrapper SpawnModules(Transform currentHub)
        {
            var spawnPoints = GetSpawnPoints(currentHub);

            foreach (var spawnPoint in spawnPoints)
            {
                if (CanSpawnHere(spawnPoint))
                {
                    var moduleToAdd = SelectModule();

                    if (moduleToAdd != null)
                    {
                        if(_genome.CanSpawn())
                        {
                            Debug.Log("adding " + moduleToAdd + " total cost = " + _genome.Cost);
                            var addedModule = GameObject.Instantiate(moduleToAdd, spawnPoint.position, spawnPoint.rotation, currentHub);
                            
                            addedModule.GetComponent<FixedJoint>().connectedBody = currentHub.GetComponent<Rigidbody>();
                            addedModule.SendMessage("SetEnemyTags", EnemyTags, SendMessageOptions.DontRequireReceiver);

                            addedModule.tag = currentHub.tag;

                            addedModule.transform.SetColor(_colour);
                            addedModule.GetComponent<Rigidbody>().velocity = InitialVelocity;

                            _genome = addedModule.Configure(_genome);

                            _genome.ModuleAdded(addedModule);
                        }
                        else
                        {
                            Debug.Log("Over budget: cost = " + _genome.Cost + ", budget = " + _genome.Budget);
                        }
                    }
                    else
                    {
                        Debug.Log("skipping null module");
                    }
                }
                else
                {
                    Debug.Log("Can not spawn module here.");
                }
            }
            return _genome;
        }

        private List<Vector3> _usedLocations = new List<Vector3>();

        /// <summary>
        /// The distance below which two test cubes colliders are considered too close to spawn.
        /// </summary>
        private const float THRESHOLD_DISTANCE = 1;

        private bool CanSpawnHere(Transform spawnPoint)
        {
            if (_testCubePrefab != null)
            {
                //Debug.Log("Creating Test Cube");
                var testCube = GameObject.Instantiate(_testCubePrefab, spawnPoint.position, spawnPoint.rotation);
                var collider = testCube.GetComponent<BoxCollider>();
                var center = collider.center;
                center = testCube.transform.TransformPoint(center); //turn it into world coords.
                //collider.bounds.Intersects();//could be useful if the center isn't enough.
                GameObject.Destroy(testCube.gameObject);
                if (IsUsedLocation(center))
                {
                    //Debug.Log("Can't spawn at " + center + " because there is already something here");
                    return false;
                }
                else
                {
                    _usedLocations.Add(center);
                }
            }
            var canSpawn = _genome.CanSpawn();
            //Debug.Log("can Spawn: " + canSpawn);
            return canSpawn;
        }

        private bool IsUsedLocation(Vector3 worldLocation)
        {
            var distances = _usedLocations.Select(l => Vector3.Distance(l, worldLocation));
            return distances.Any(d => d < THRESHOLD_DISTANCE);
        }

        private List<Transform> GetSpawnPoints(Transform currentHub)
        {
            var _spawnPoints = new List<Transform>();
            var childCount = currentHub.childCount;
            for (int i = 0; i < childCount; i++)
            {
                var child = currentHub.GetChild(i);
                if (child.name.Contains("SP"))
                {
                    _spawnPoints.Add(child);
                }
            }
            return _spawnPoints;
        }

        private ModuleTypeKnower SelectModule()
        {
            if (_genome.CanSpawn())
            {
                int? number = _genome.GetGeneAsInt();
                if (number.HasValue)
                {
                    //Debug.Log("Gene as number: " + number);
                    if (number < _moduleList.Modules.Count())
                    {
                        //Debug.Log("Adding Module " + number + ": " + Modules[number] );
                        return _moduleList.Modules[number.Value];
                    }
                    //else
                    //{
                    //    Debug.Log("there are " + Modules.Count() + " modules, so cannot spawn number " + number);
                    //}
                }
                //else
                //{
                //    Debug.Log("Failed to parse " + simplified + "as a number");
                //}
            }
            //else
            //{
            //    Debug.Log("Cannot read gene of length " + GeneLength + " at position " + _genomePosition + " in '" + _genome + "'");
            //}
            return null;
        }

        private void ConfigureShip()
        {
            var controller = _shipToBuildOn.GetComponent<SpaceShipControler>();

            //Debug.Log("ConfiguringShip");

            controller.ShootAngle =
                _genome.GetNumberFromGenome(0, DefaultShootAngleProportion) * MaxShootAngle;
            controller.LocationAimWeighting =
                _genome.GetNumberFromGenome(2, DefaultLocationAimWeightingProportion) * MaxLocationAimWeighting;
            controller.SlowdownWeighting =
                _genome.GetNumberFromGenome(4, DefaultSlowdownWeightingProportion) * MaxSlowdownWeighting;
            controller.MaxRange =
                _genome.GetNumberFromGenome(6, DefaultMaxAndMinRangeProportion) * MaxMaxAndMinRange;
            controller.MinRange =
                _genome.GetNumberFromGenome(8, DefaultMaxAndMinRangeProportion) * MaxMaxAndMinRange;
            controller.MaxTangentialVelocity =
                _genome.GetNumberFromGenome(10, DefaultVelociyTolleranceProportion) * MaxVelociyTollerance;
            controller.MinTangentialVelocity =
                _genome.GetNumberFromGenome(12, DefaultVelociyTolleranceProportion) * MaxVelociyTollerance;
            controller.TangentialSpeedWeighting =
                _genome.GetNumberFromGenome(14, DefaultTangentialVelosityWeightingProportion) * MaxTangentialVelosityWeighting;
            controller.AngularDragForTorquers =
                _genome.GetNumberFromGenome(16, DefaultAngularDragForTorquersProportion) * MaxAngularDragForTorquers;
            controller.RadialSpeedThreshold =
                _genome.GetNumberFromGenome(18, DefaultVelociyTolleranceProportion) * MaxVelociyTollerance;
        }

        

    }
}

