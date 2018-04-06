using Assets.Src.Database;
using UnityEngine;

public class MainMenuController : MonoBehaviour {
    public Camera Camera;
    public Transform MainMenuCameraTarget;
    public Transform CameraTarget;
    public float CameraMoveSpeed = 10;
    public float CameraRotateSpeed = 30;

    // Use this for initialization
    void Start () {
        var initialiser = new DatabaseInitialiser();
        initialiser.EnsureDatabaseExists();
	}
	
	// Update is called once per frame
	void Update ()
    {
        if (Input.GetKeyUp(KeyCode.Escape) && MainMenuCameraTarget != null)
        {
            CameraTarget = MainMenuCameraTarget;
        }
        //TODO make this move nicer.
        Camera.transform.position = Vector3.MoveTowards(Camera.transform.position, CameraTarget.position, Time.deltaTime * CameraMoveSpeed);
        Camera.transform.rotation = Quaternion.RotateTowards(Camera.transform.rotation, CameraTarget.rotation, Time.deltaTime * CameraRotateSpeed);
    }
}
